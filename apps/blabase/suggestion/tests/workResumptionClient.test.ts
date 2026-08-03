import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindWorkSession,
  fetchWorkResumption,
  openWorkSession,
  unbindWorkSession,
  type WorkResumptionTaskRef
} from "../app/workResumptionClient";

const taskRef: WorkResumptionTaskRef = {
  kind: "attention_subject",
  source: "github",
  subjectId: "repo:blabase:issue:42",
  displayTitle: "Phase 2B 작업 설정"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("work resumption client", () => {
  it("reads the binding snapshot without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "ready",
        companion: { state: "offline", lastSeenAt: null },
        bindings: []
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWorkResumption();

    expect(result.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith("/api/work-resumption", {
      cache: "no-store"
    });
  });

  it("polls a command through the same route using an encoded id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "ready",
        companion: {
          state: "online",
          lastSeenAt: "2026-07-30T00:00:00.000Z"
        },
        bindings: [],
        command: {
          commandId: "command_0123456789abcdef0123456789abcdef",
          status: "completed"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchWorkResumption(
      "command_0123456789abcdef0123456789abcdef"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/work-resumption?commandId=command_0123456789abcdef0123456789abcdef",
      { cache: "no-store" }
    );
  });

  it("binds only after explicit user confirmation and does not invent a scope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(readyMutationResponse());
    vi.stubGlobal("fetch", fetchMock);

    await bindWorkSession({
      taskRef,
      executionId: "codex:execution:0123456789abcdef01234567"
    });

    expectMutation(fetchMock, {
      action: "bind",
      taskRef,
      executionId: "codex:execution:0123456789abcdef01234567",
      explicitUserConfirmation: true
    });
  });

  it("uses explicit mutations for unlinking and opening without prompt content", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => readyMutationResponse());
    vi.stubGlobal("fetch", fetchMock);

    await unbindWorkSession({ taskRef });
    await openWorkSession({ taskRef });

    expectMutation(fetchMock, {
      action: "unbind",
      taskRef,
      explicitUserConfirmation: true
    }, 0);
    expectMutation(fetchMock, {
      action: "open",
      taskRef,
      explicitUserAction: true
    }, 1);
    const openBody = mutationBody(fetchMock, 1);
    expect(openBody).not.toHaveProperty("prompt");
    expect(openBody).not.toHaveProperty("command");
  });

  it("raises a typed error for rejected requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            status: "error",
            code: "COMPANION_OFFLINE",
            message: "Local companion is offline."
          },
          409
        )
      )
    );

    await expect(openWorkSession({ taskRef })).rejects.toMatchObject({
      name: "WorkResumptionRequestError",
      code: "COMPANION_OFFLINE",
      message: "Local companion is offline."
    });
  });

  it("sends the exact managed binding identity when opening a recommendation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(readyMutationResponse());
    vi.stubGlobal("fetch", fetchMock);
    const expectedBindingId = `binding_${"b".repeat(32)}`;
    const expectedExecutionId =
      `codex:execution:${"c".repeat(24)}`;

    await openWorkSession({
      taskRef,
      expectedBindingId,
      expectedExecutionId
    });

    expectMutation(fetchMock, {
      action: "open",
      taskRef,
      explicitUserAction: true,
      expectedBindingId,
      expectedExecutionId
    });
  });

  it("rejects a partial expected identity before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      openWorkSession({
        taskRef,
        expectedBindingId: `binding_${"b".repeat(32)}`
      })
    ).rejects.toThrow(
      "Expected binding and execution identity must be provided together."
    );
    await expect(
      openWorkSession({
        taskRef,
        expectedExecutionId: `codex:execution:${"c".repeat(24)}`
      })
    ).rejects.toThrow(
      "Expected binding and execution identity must be provided together."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not silently omit a complete identity pair that the server must validate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(readyMutationResponse());
    vi.stubGlobal("fetch", fetchMock);

    await openWorkSession({
      taskRef,
      expectedBindingId: "",
      expectedExecutionId: ""
    });

    expectMutation(fetchMock, {
      action: "open",
      taskRef,
      explicitUserAction: true,
      expectedBindingId: "",
      expectedExecutionId: ""
    });
  });
});

function readyMutationResponse(): Response {
  return jsonResponse({
    status: "ready",
    companion: {
      state: "online",
      lastSeenAt: "2026-07-30T00:00:00.000Z"
    },
    bindings: []
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function expectMutation(
  fetchMock: ReturnType<typeof vi.fn>,
  expectedBody: unknown,
  callIndex = 0
): void {
  const call = fetchMock.mock.calls[callIndex] as
    | [string, RequestInit]
    | undefined;
  expect(call?.[0]).toBe("/api/work-resumption");
  expect(call?.[1]).toMatchObject({
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  expect(JSON.parse(String(call?.[1].body))).toEqual(expectedBody);
}

function mutationBody(
  fetchMock: ReturnType<typeof vi.fn>,
  callIndex: number
): Record<string, unknown> {
  const call = fetchMock.mock.calls[callIndex] as
    | [string, RequestInit]
    | undefined;
  return JSON.parse(String(call?.[1].body)) as Record<string, unknown>;
}
