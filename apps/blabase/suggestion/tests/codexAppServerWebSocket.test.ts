import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  CodexAppServerWebSocketError,
  openCodexAppServerWebSocket,
  type CodexAppServerSpawn,
  type CodexAppServerWebSocketFactory,
  type CodexAppServerWebSocketLike
} from "../src/connectors/codex/appServerWebSocket";

describe("Codex App Server WebSocket transport", () => {
  it("spawns only a loopback listener with an allowlisted environment and performs the fixed handshake", async () => {
    const harness = createHarness();

    const session = await harness.open({
      env: {
        NODE_ENV: "test",
        HOME: "/Users/example",
        PATH: "/usr/local/bin",
        SECRET_TOKEN: "must-not-cross-the-boundary"
      }
    });

    expect(session.endpoint).toBe("ws://127.0.0.1:43123");
    expect(session.initializeResult).toEqual({
      userAgent: "codex_app_server/0.145.0"
    });
    expect(harness.spawnProcess).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["app-server", "--listen", "ws://127.0.0.1:43123"],
      expect.objectContaining({
        cwd: "/tmp/blabase-project",
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          NODE_ENV: "test",
          HOME: "/Users/example",
          PATH: "/usr/local/bin"
        }
      })
    );
    expect(harness.createWebSocket).toHaveBeenCalledWith(
      "ws://127.0.0.1:43123"
    );
    expect(harness.socket.sentMessages()).toEqual([
      {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "blabase_suggestion",
            title: "blabase Suggestion",
            version: "0.1.0"
          }
        }
      },
      { method: "initialized", params: {} }
    ]);

    await session.close();
    expect(harness.socket.closeCalls).toBe(1);
    expect(harness.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("matches client responses while preserving ordered notification callbacks", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const observed: string[] = [];
    const harness = createHarness();
    const session = await harness.open({
      onNotification: async (notification) => {
        observed.push(`start:${notification.method}`);
        if (notification.method === "first") await firstGate;
        observed.push(`end:${notification.method}`);
      }
    });

    const request = session.request("thread/list", { limit: 1 });
    harness.socket.receive({ method: "first", params: { value: 1 } });
    harness.socket.receive({ method: "second", params: { value: 2 } });
    harness.socket.receive({ id: 2, result: { data: [] } });

    await expect(request).resolves.toEqual({ data: [] });
    await vi.waitFor(() => {
      expect(observed).toEqual(["start:first"]);
    });
    releaseFirst?.();
    await vi.waitFor(() => {
      expect(observed).toEqual([
        "start:first",
        "end:first",
        "start:second",
        "end:second"
      ]);
    });
    await session.close();
  });

  it("accepts standards-compliant MessageEvent data inherited from its prototype", async () => {
    const harness = createHarness();
    const session = await harness.open();
    const request = session.request("thread/list");
    const event = Object.create({
      data: JSON.stringify({ id: 2, result: { data: [] } })
    });

    harness.socket.receiveEvent(event);

    await expect(request).resolves.toEqual({ data: [] });
    await session.close();
  });

  it("includes initialize capabilities only when the caller provides them", async () => {
    const harness = createHarness();
    const capabilities = {
      optOutNotificationMethods: [
        "item/agentMessage/delta",
        "item/reasoning/textDelta"
      ]
    };

    const session = await harness.open({
      initializeCapabilities: capabilities
    });

    expect(harness.socket.sentMessages()[0]).toMatchObject({
      method: "initialize",
      params: { capabilities }
    });
    await session.close();
  });

  it("distinguishes a server request from a colliding client response and never auto-responds", async () => {
    const serverRequests: unknown[] = [];
    const harness = createHarness();
    const session = await harness.open({
      onServerRequest: (request) => {
        serverRequests.push(request);
      }
    });
    const request = session.request("thread/read", {
      threadId: "thread-a"
    });
    const sentBeforeServerRequest = harness.socket.sent.length;

    harness.socket.receive({
      id: 2,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "private-native-thread" }
    });
    await vi.waitFor(() => {
      expect(serverRequests).toEqual([
        {
          id: 2,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "private-native-thread" }
        }
      ]);
    });
    expect(harness.socket.sent).toHaveLength(
      sentBeforeServerRequest
    );

    harness.socket.receive({ id: 2, result: { thread: "ok" } });
    await expect(request).resolves.toEqual({ thread: "ok" });
    await session.close();
  });

  it("fails closed and cleans up when an inbound or outbound message exceeds the bound", async () => {
    const inbound = createHarness();
    const inboundSession = await inbound.open({
      maxMessageBytes: 1024
    });
    const pending = inboundSession.request("thread/list");
    inbound.socket.receiveText("x".repeat(1025));
    await expect(pending).rejects.toMatchObject({
      code: "APP_SERVER_MESSAGE_TOO_LARGE"
    });
    expect(inbound.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(inbound.socket.closeCalls).toBe(1);

    const outbound = createHarness();
    const outboundSession = await outbound.open({
      maxMessageBytes: 1024
    });
    await expect(
      outboundSession.request("turn/start", {
        input: "x".repeat(2048)
      })
    ).rejects.toMatchObject({
      code: "APP_SERVER_MESSAGE_TOO_LARGE"
    });
    expect(outbound.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("times out an individual request without inventing a response", async () => {
    const harness = createHarness();
    const session = await harness.open({ requestTimeoutMs: 10 });

    await expect(session.request("thread/list")).rejects.toMatchObject({
      code: "APP_SERVER_REQUEST_TIMEOUT"
    });
    expect(harness.socket.readyState).toBe(1);
    expect(harness.child.kill).not.toHaveBeenCalled();
    await session.close();
  });

  it("aborts pending work and cleans up both the socket and child process", async () => {
    const controller = new AbortController();
    const harness = createHarness();
    const session = await harness.open({ signal: controller.signal });
    const pending = session.request("thread/list");

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "APP_SERVER_ABORTED"
    });
    expect(harness.socket.closeCalls).toBe(1);
    expect(harness.child.kill).toHaveBeenCalledWith("SIGTERM");
    await session.close();
    expect(harness.socket.closeCalls).toBe(1);
  });

  it.each(["socket", "child"] as const)(
    "rejects pending requests and cleans the peer when the %s closes",
    async (closedPeer) => {
      const harness = createHarness();
      const session = await harness.open();
      const pending = session.request("thread/list");

      if (closedPeer === "socket") {
        harness.socket.remoteClose();
      } else {
        harness.child.emit("exit", 1, null);
      }

      await expect(pending).rejects.toMatchObject({
        code: "APP_SERVER_CLOSED"
      });
      expect(harness.child.kill).toHaveBeenCalledWith("SIGTERM");
      if (closedPeer === "child") {
        expect(harness.socket.closeCalls).toBe(1);
      }
    }
  );

  it("reports an unexpected close exactly once with a sanitized error", async () => {
    const closed = vi.fn();
    const harness = createHarness();
    const session = await harness.open({ onClose: closed });

    harness.socket.remoteClose();
    harness.child.emit("exit", 1, null);
    await session.close();

    expect(closed).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CodexAppServerWebSocketError",
        code: "APP_SERVER_CLOSED",
        message: "Codex App Server WebSocket 연결이 종료되었습니다."
      }),
      { expected: false }
    );
  });

  it("marks an explicit close and notifies late subscribers once", async () => {
    const closed = vi.fn();
    const lateSubscriber = vi.fn();
    const harness = createHarness();
    const session = await harness.open();
    session.onClose(closed);

    await session.close();
    session.onClose(lateSubscriber);
    await Promise.resolve();

    expect(closed).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledWith(
      expect.objectContaining({ code: "APP_SERVER_CLOSED" }),
      { expected: true }
    );
    expect(lateSubscriber).toHaveBeenCalledOnce();
    expect(lateSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ code: "APP_SERVER_CLOSED" }),
      { expected: true }
    );
  });

  it("bounds connection startup and cleans a socket that never opens", async () => {
    const harness = createHarness({ autoOpen: false });

    await expect(
      harness.open({ connectionTimeoutMs: 10 })
    ).rejects.toMatchObject({
      code: "APP_SERVER_CONNECTION_TIMEOUT"
    });
    expect(harness.socket.closeCalls).toBe(1);
    expect(harness.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stops waiting immediately when the child exits during startup", async () => {
    const harness = createHarness({ autoOpen: false });
    const opening = harness.open({ connectionTimeoutMs: 100 });
    queueMicrotask(() => harness.child.emit("exit", 1, null));

    await expect(opening).rejects.toMatchObject({
      code: "APP_SERVER_CONNECTION_FAILED"
    });
    expect(harness.socket.closeCalls).toBe(1);
    expect(harness.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects an invalid injected port before spawning", async () => {
    const harness = createHarness();

    await expect(harness.open({ getPort: () => 0 })).rejects.toBeInstanceOf(
      CodexAppServerWebSocketError
    );
    expect(harness.spawnProcess).not.toHaveBeenCalled();
  });
});

function createHarness(input: { autoOpen?: boolean } = {}) {
  const child = fakeChildProcess();
  const socket = new FakeWebSocket();
  const spawnProcess = vi.fn<CodexAppServerSpawn>(() => child);
  const createWebSocket = vi.fn<CodexAppServerWebSocketFactory>(
    () => {
      if (input.autoOpen !== false) {
        queueMicrotask(() => socket.open());
      }
      return socket;
    }
  );

  return {
    child,
    socket,
    spawnProcess,
    createWebSocket,
    open: (
      overrides: Partial<
        Parameters<typeof openCodexAppServerWebSocket>[0]
      > = {}
    ) =>
      openCodexAppServerWebSocket({
        binaryPath: "/usr/local/bin/codex",
        cwd: "/tmp/blabase-project",
        getPort: () => 43123,
        spawnProcess,
        createWebSocket,
        connectionTimeoutMs: 100,
        requestTimeoutMs: 100,
        ...overrides
      })
  };
}

class FakeWebSocket implements CodexAppServerWebSocketLike {
  readyState = 0;
  binaryType = "blob";
  closeCalls = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Set<(event: unknown) => void>
  >();

  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data) as {
      id?: number;
      method?: string;
    };
    if (message.method === "initialize" && message.id) {
      queueMicrotask(() =>
        this.receive({
          id: message.id,
          result: { userAgent: "codex_app_server/0.145.0" }
        })
      );
    }
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.emit("close", {});
  }

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receive(message: unknown): void {
    this.receiveText(JSON.stringify(message));
  }

  receiveText(data: string): void {
    this.emit("message", { data });
  }

  receiveEvent(event: unknown): void {
    this.emit("message", event);
  }

  remoteClose(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  sentMessages(): unknown[] {
    return this.sent.map((message) => JSON.parse(message));
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stderr: { resume: ReturnType<typeof vi.fn> };
    killed: boolean;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = { resume: vi.fn() };
  child.killed = false;
  child.exitCode = null;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child as unknown as ChildProcess;
}
