import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/resumption", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/resumption")>();
  return {
    ...actual,
    bindWorkSession: vi.fn(),
    openWorkSession: vi.fn(),
    readWorkResumptionCommandStatus: vi.fn(),
    readWorkResumptionStatus: vi.fn(),
    unbindWorkSession: vi.fn()
  };
});

vi.mock("../src/relations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/relations")>();
  return {
    ...actual,
    validateStoredGitHubBindingTarget: vi.fn()
  };
});

import {
  GET as getWorkResumption,
  POST as postWorkResumption
} from "../app/api/work-resumption/route";
import {
  WorkResumptionStoreError,
  bindWorkSession,
  openWorkSession,
  readWorkResumptionCommandStatus,
  readWorkResumptionStatus,
  unbindWorkSession
} from "../src/resumption";
import {
  WorkRelationTargetError,
  validateStoredGitHubBindingTarget
} from "../src/relations";

const EXECUTION_ID = `codex:execution:${"1".repeat(24)}`;
const SCOPE_ID = "a".repeat(24);
const COMMAND_ID = `command_${"c".repeat(32)}`;
const taskRef = {
  kind: "attention_subject" as const,
  source: "github" as const,
  subjectId: "github:issue:101:42",
  displayTitle: "Phase 2B 작업 설정"
};
const taskIdentity = {
  kind: taskRef.kind,
  source: taskRef.source,
  subjectId: taskRef.subjectId
};
const binding = {
  bindingId: `binding_${"b".repeat(32)}`,
  taskRef: taskIdentity,
  executionId: EXECUTION_ID,
  boundAt: "2026-07-30T00:00:00.000Z"
};
const command = {
  commandId: COMMAND_ID,
  bindingId: binding.bindingId,
  operation: "focus_or_resume" as const,
  status: "pending" as const,
  createdAt: "2026-07-30T00:00:00.000Z",
  expiresAt: "2026-07-30T00:00:30.000Z",
  completedAt: null,
  resultCode: null
};
const snapshot = {
  companion: {
    state: "online" as const,
    lastSeenAt: "2026-07-30T00:00:00.000Z"
  },
  bindings: [binding]
};

beforeEach(() => {
  setDevelopment();
  vi.mocked(readWorkResumptionStatus).mockResolvedValue(snapshot);
  vi.mocked(bindWorkSession).mockResolvedValue(binding);
  vi.mocked(unbindWorkSession).mockResolvedValue(true);
  vi.mocked(openWorkSession).mockResolvedValue(command);
  vi.mocked(readWorkResumptionCommandStatus).mockResolvedValue(
    command
  );
  vi.mocked(validateStoredGitHubBindingTarget).mockResolvedValue({
    subjectId: taskRef.subjectId,
    objectType: "issue",
    number: 42
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("work resumption route", () => {
  it("reads local status and rejects remote or cross-origin reads", async () => {
    const ready = await getWorkResumption(
      new Request("http://localhost:3102/api/work-resumption")
    );
    const crossOrigin = await getWorkResumption(
      new Request("http://localhost:3102/api/work-resumption", {
        headers: { origin: "https://evil.example" }
      })
    );
    const remote = await getWorkResumption(
      new Request("http://example.com/api/work-resumption")
    );

    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    const payload = await ready.json();
    expect(payload).toEqual({
      status: "ready",
      ...snapshot
    });
    expect(JSON.stringify(payload.bindings)).not.toContain(
      taskRef.displayTitle
    );
    expect(payload.bindings[0]).not.toHaveProperty("scopeId");
    expect(crossOrigin.status).toBe(403);
    expect(remote.status).toBe(404);
  });

  it("delegates stored execution validation and atomic scope derivation to the store", async () => {
    const response = await postWorkResumption(
      mutationRequest({
        action: "bind",
        taskRef,
        executionId: EXECUTION_ID,
        explicitUserConfirmation: true
      })
    );

    expect(response.status).toBe(200);
    expect(bindWorkSession).toHaveBeenCalledWith({
      taskRef,
      executionId: EXECUTION_ID,
      explicitUserConfirmation: true
    });
    expect(validateStoredGitHubBindingTarget).toHaveBeenCalledWith(
      taskRef
    );
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      ...snapshot
    });
  });

  it("fails closed when an exact GitHub work identity cannot be verified", async () => {
    vi.mocked(validateStoredGitHubBindingTarget).mockRejectedValueOnce(
      new WorkRelationTargetError("GITHUB_WORK_ITEM_NOT_FOUND")
    );

    const response = await postWorkResumption(
      mutationRequest({
        action: "bind",
        taskRef,
        executionId: EXECUTION_ID,
        explicitUserConfirmation: true
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      code: "GITHUB_WORK_ITEM_NOT_FOUND"
    });
    expect(bindWorkSession).not.toHaveBeenCalled();
  });

  it("rejects bare IDs, client scope injection, and missing explicit confirmation", async () => {
    const bareId = await postWorkResumption(
      mutationRequest({
        action: "bind",
        taskRef,
        executionId: "1".repeat(24),
        explicitUserConfirmation: true
      })
    );
    const scopeInjection = await postWorkResumption(
      mutationRequest({
        action: "bind",
        taskRef,
        executionId: EXECUTION_ID,
        scopeId: SCOPE_ID,
        explicitUserConfirmation: true
      })
    );
    const implicit = await postWorkResumption(
      mutationRequest({
        action: "unbind",
        taskRef
      })
    );

    expect(bareId.status).toBe(400);
    expect(scopeInjection.status).toBe(400);
    expect(implicit.status).toBe(400);
    expect(bindWorkSession).not.toHaveBeenCalled();
    expect(unbindWorkSession).not.toHaveBeenCalled();
  });

  it("requires same-origin mutation and a distinct explicit open action", async () => {
    const missingOrigin = await postWorkResumption(
      new Request(
        "http://localhost:3102/api/work-resumption",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "open",
            taskRef,
            explicitUserAction: true
          })
        }
      )
    );
    const wrongConsentField = await postWorkResumption(
      mutationRequest({
        action: "open",
        taskRef,
        explicitUserConfirmation: true
      })
    );
    const accepted = await postWorkResumption(
      mutationRequest({
        action: "open",
        taskRef,
        explicitUserAction: true
      })
    );

    expect(missingOrigin.status).toBe(403);
    expect(wrongConsentField.status).toBe(400);
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toEqual({
      status: "ready",
      ...snapshot,
      acceptedCommand: command
    });
  });

  it("never queues when the companion is offline", async () => {
    vi.mocked(openWorkSession).mockRejectedValueOnce(
      new WorkResumptionStoreError("COMPANION_OFFLINE")
    );

    const response = await postWorkResumption(
      mutationRequest({
        action: "open",
        taskRef,
        explicitUserAction: true
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      code: "COMPANION_OFFLINE"
    });
    expect(readWorkResumptionStatus).not.toHaveBeenCalled();
  });

  it("queries a sanitized command status and distinguishes invalid or missing IDs", async () => {
    const ready = await getWorkResumption(
      new Request(
        `http://localhost:3102/api/work-resumption?commandId=${COMMAND_ID}`
      )
    );
    const invalid = await getWorkResumption(
      new Request(
        "http://localhost:3102/api/work-resumption?commandId=../../secret"
      )
    );
    vi.mocked(readWorkResumptionCommandStatus).mockResolvedValueOnce(
      null
    );
    const missing = await getWorkResumption(
      new Request(
        `http://localhost:3102/api/work-resumption?commandId=${COMMAND_ID}`
      )
    );

    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      status: "ready",
      ...snapshot,
      command
    });
    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it("does not resolve an unknown Codex execution into a binding", async () => {
    vi.mocked(bindWorkSession).mockRejectedValueOnce(
      new WorkResumptionStoreError("CODEX_EXECUTION_NOT_FOUND")
    );

    const response = await postWorkResumption(
      mutationRequest({
        action: "bind",
        taskRef,
        executionId: EXECUTION_ID,
        explicitUserConfirmation: true
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "CODEX_EXECUTION_NOT_FOUND"
    });
    expect(bindWorkSession).toHaveBeenCalledOnce();
  });
});

function setDevelopment() {
  vi.stubEnv("NODE_ENV", "development");
}

function mutationRequest(body: unknown): Request {
  return new Request(
    "http://localhost:3102/api/work-resumption",
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
