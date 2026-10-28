import { PassThrough, Readable, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  LAUNCHER_EXECUTION_CONTRACT,
  LAUNCHER_IPC_CONTRACT,
  LauncherService,
  LauncherServiceError,
  MAX_LAUNCHER_IPC_LINE_BYTES,
  launcherIpcResponseSchema,
  processLauncherIpcLine,
  runLauncherJsonlSession
} from "../src/launcher";

const COMMAND_ID = `command_${"c".repeat(32)}`;

describe("launcher JSONL IPC", () => {
  it("accepts a contract request and emits the bounded public result", async () => {
    const service = serviceStub();

    await expect(
      processLauncherIpcLine(
        JSON.stringify(commandRequest("request-valid")),
        service
      )
    ).resolves.toEqual({
      contract: LAUNCHER_IPC_CONTRACT,
      requestId: "request-valid",
      ok: true,
      result: executionResult()
    });
    expect(service.handle).toHaveBeenCalledTimes(1);
  });

  it("parses status.get without changing the v1 IPC envelope", async () => {
    const service: Pick<LauncherService, "handle"> = {
      handle: vi.fn(async () => statusResult())
    };

    await expect(
      processLauncherIpcLine(
        JSON.stringify(statusRequest("request-status")),
        service
      )
    ).resolves.toEqual({
      contract: LAUNCHER_IPC_CONTRACT,
      requestId: "request-status",
      ok: true,
      result: statusResult()
    });
    expect(service.handle).toHaveBeenCalledWith(
      statusRequest("request-status")
    );
  });

  it("parses the additive work-board.get method in the unchanged v1 envelope", async () => {
    const result = {
      contract: "blabase-launcher-work-board-v1" as const,
      generatedAt: "2026-08-13T09:00:00.000Z",
      mode: "full" as const,
      prominentLane: "none" as const,
      continuationStatus: "empty" as const,
      items: []
    };
    const service: Pick<LauncherService, "handle"> = {
      handle: vi.fn(async () => result)
    };
    const request = {
      contract: LAUNCHER_IPC_CONTRACT,
      requestId: "request-work-board",
      method: "work-board.get" as const,
      params: { refresh: false }
    };

    await expect(
      processLauncherIpcLine(JSON.stringify(request), service)
    ).resolves.toEqual({
      contract: LAUNCHER_IPC_CONTRACT,
      requestId: "request-work-board",
      ok: true,
      result
    });
    expect(service.handle).toHaveBeenCalledWith(request);
  });

  it("rejects invalid JSON without reflecting private input", async () => {
    const service = serviceStub();
    const privateText = "private-prompt-that-must-not-be-reflected";

    const response = await processLauncherIpcLine(
      `{${privateText}`,
      service
    );

    expect(response).toMatchObject({
      requestId: null,
      ok: false,
      error: { code: "INVALID_JSON" }
    });
    expect(JSON.stringify(response)).not.toContain(privateText);
    expect(service.handle).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "unknown methods",
      request: {
        contract: LAUNCHER_IPC_CONTRACT,
        requestId: "request-unknown",
        method: "shell.execute",
        params: { command: "rm -rf /" }
      }
    },
    {
      label: "extra prompt fields",
      request: {
        ...commandRequest("request-extra"),
        prompt: "upload this entire conversation"
      }
    },
    {
      label: "extra command parameters",
      request: {
        ...commandRequest("request-extra-param"),
        params: {
          commandId: COMMAND_ID,
          command: "open arbitrary target"
        }
      }
    },
    {
      label: "extra status parameters",
      request: {
        ...statusRequest("request-status-extra"),
        params: { dataRoot: "/private/root" }
      }
    },
    {
      label: "extra Work Board parameters",
      request: {
        contract: LAUNCHER_IPC_CONTRACT,
        requestId: "request-work-board-extra",
        method: "work-board.get",
        params: { refresh: false, itemRef: "private" }
      }
    }
  ])("rejects $label", async ({ request }) => {
    const service = serviceStub();

    const response = await processLauncherIpcLine(
      JSON.stringify(request),
      service
    );

    expect(response).toMatchObject({
      requestId: request.requestId,
      ok: false,
      error: { code: "INVALID_REQUEST" }
    });
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("rejects an oversized request before parsing it", async () => {
    const service = serviceStub();
    const line = "x".repeat(MAX_LAUNCHER_IPC_LINE_BYTES + 1);

    const response = await processLauncherIpcLine(line, service);

    expect(response).toMatchObject({
      requestId: null,
      ok: false,
      error: { code: "REQUEST_TOO_LARGE" }
    });
    expect(service.handle).not.toHaveBeenCalled();
  });

  it("maps only a sanitized service error into the response", async () => {
    const service = serviceStub(
      new LauncherServiceError(
        "COMMAND_NOT_FOUND",
        "작업 열기 요청을 찾지 못했습니다."
      )
    );

    const response = await processLauncherIpcLine(
      JSON.stringify(commandRequest("request-missing")),
      service
    );

    expect(response).toMatchObject({
      requestId: "request-missing",
      ok: false,
      error: { code: "COMMAND_NOT_FOUND" }
    });
  });

  it("writes stdout as parseable JSONL with no diagnostic contamination", async () => {
    const chunks: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });
    const privateText = "never-copy-this-private-prompt";
    const readable = Readable.from([
      `${JSON.stringify(commandRequest("request-one"))}\n`,
      `{${privateText}\n`
    ]);

    await runLauncherJsonlSession({
      readable,
      writable,
      service: serviceStub()
    });

    const output = chunks.join("");
    const lines = output.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(() =>
        launcherIpcResponseSchema.parse(JSON.parse(line))
      ).not.toThrow();
    }
    expect(output).not.toContain("warning");
    expect(output).not.toContain(privateText);
  });

  it("rejects a split oversized line and resumes at the next request", async () => {
    const service = serviceStub();
    const chunks: string[] = [];
    const writable = collectingWritable(chunks);
    const request = commandRequest("request-after-oversized");
    const readable = Readable.from([
      "x".repeat(MAX_LAUNCHER_IPC_LINE_BYTES - 1),
      "xxxx",
      `\r\n${JSON.stringify(request)}\n`
    ]);

    await runLauncherJsonlSession({ readable, writable, service });

    const responses = parseResponses(chunks);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      requestId: null,
      ok: false,
      error: { code: "REQUEST_TOO_LARGE" }
    });
    expect(responses[1]).toMatchObject({
      requestId: "request-after-oversized",
      ok: true
    });
    expect(service.handle).toHaveBeenCalledTimes(1);
    expect(service.handle).toHaveBeenCalledWith(request);
  });

  it("preserves split CRLF, an unterminated final line, and sequential handling", async () => {
    const chunks: string[] = [];
    let active = 0;
    let maxActive = 0;
    const handledRequestIds: string[] = [];
    const service: Pick<LauncherService, "handle"> = {
      handle: vi.fn(async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        handledRequestIds.push(request.requestId);
        active -= 1;
        return executionResult();
      })
    };
    const first = JSON.stringify(commandRequest("request-crlf"));
    const second = JSON.stringify(commandRequest("request-final"));

    await runLauncherJsonlSession({
      readable: Readable.from([`${first}\r`, `\n${second}`]),
      writable: collectingWritable(chunks),
      service
    });

    expect(maxActive).toBe(1);
    expect(handledRequestIds).toEqual([
      "request-crlf",
      "request-final"
    ]);
    expect(parseResponses(chunks).map((response) => response.requestId)).toEqual([
      "request-crlf",
      "request-final"
    ]);
  });

  it("stops on abort without flushing a partial final line", async () => {
    const service = serviceStub();
    const readable = new PassThrough();
    const chunks: string[] = [];
    const controller = new AbortController();
    const session = runLauncherJsonlSession({
      readable,
      writable: collectingWritable(chunks),
      service,
      signal: controller.signal
    });

    readable.write(JSON.stringify(commandRequest("request-partial")));
    controller.abort();
    await session;
    readable.destroy();

    expect(chunks).toEqual([]);
    expect(service.handle).not.toHaveBeenCalled();
  });
});

function collectingWritable(chunks: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
}

function parseResponses(chunks: string[]) {
  return chunks
    .join("")
    .trimEnd()
    .split("\n")
    .map((line) => launcherIpcResponseSchema.parse(JSON.parse(line)));
}

function commandRequest(requestId: string) {
  return {
    contract: LAUNCHER_IPC_CONTRACT,
    requestId,
    method: "command.get" as const,
    params: { commandId: COMMAND_ID }
  };
}

function statusRequest(requestId: string) {
  return {
    contract: LAUNCHER_IPC_CONTRACT,
    requestId,
    method: "status.get" as const,
    params: {}
  };
}

function executionResult() {
  return {
    contract: LAUNCHER_EXECUTION_CONTRACT,
    kind: "focus_or_resume" as const,
    commandId: COMMAND_ID,
    status: "completed" as const
  };
}

function statusResult() {
  return {
    contract: "blabase-launcher-status-v1" as const,
    rootId: `root_${"a".repeat(32)}`,
    sourceMode: "managed" as const,
    mutationAuthority: "launcher_agent" as const,
    syncRevision: "pipeline:0123456789abcdef0123456789abcdef"
  };
}

function serviceStub(error?: Error): Pick<LauncherService, "handle"> {
  return {
    handle: vi.fn(async () => {
      if (error) throw error;
      return executionResult();
    })
  };
}
