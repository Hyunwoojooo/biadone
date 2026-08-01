import { describe, expect, it, vi } from "vitest";

import {
  CodexAppServerWebSocketError,
  type CodexAppServerCloseHandler,
  type CodexAppServerNotificationHandler,
  type CodexAppServerRequestHandler,
  type CodexAppServerWebSocketSession,
  type OpenCodexAppServerWebSocketOptions
} from "../src/connectors/codex/appServerWebSocket";
import {
  ManagedCodexResumeLauncher,
  ManagedCodexRunManager,
  type ManagedCodexRuntimePersistence,
  type ManagedCodexOwnershipExecutor
} from "../src/managedCodex/runtime";
import type { ManagedCodexPublicRunProjection } from "../src/managedCodex/contracts";
import type { ResumeLaunchInput } from "../src/resumption/companion/types";

const MANAGED_RUN_ID = `managed_run_${"a".repeat(32)}`;
const OWNER_INSTANCE_ID = `instance_${"b".repeat(32)}`;
const STREAM_ONE = `stream_${"c".repeat(32)}`;
const STREAM_TWO = `stream_${"d".repeat(32)}`;
const NATIVE_THREAD_ID = "019c1234-abcd-7000-8000-123456789abc";

describe("managed Codex runtime", () => {
  it("subscribes the explicit thread before launching the remote TUI", async () => {
    const harness = runtimeHarness();
    const terminal = { focusOrResume: vi.fn(async () => "RESUMED_IN_TERMINAL" as const) };
    const launcher = new ManagedCodexResumeLauncher(
      harness.manager,
      terminal
    );

    await expect(launcher.focusOrResume(launchInput())).resolves.toBe(
      "RESUMED_IN_TERMINAL"
    );

    expect(harness.sessions[0]?.requests).toEqual([
      {
        method: "thread/resume",
        params: { threadId: NATIVE_THREAD_ID }
      }
    ]);
    expect(harness.persistenceCalls.map((call) => call.kind)).toEqual([
      "begin",
      "stream_connected"
    ]);
    expect(terminal.focusOrResume).toHaveBeenCalledWith({
      ...launchInput(),
      remoteEndpoint: "ws://127.0.0.1:4500"
    });
    expect(harness.openOptions[0]?.initializeCapabilities).toEqual({
      optOutNotificationMethods: expect.arrayContaining([
        "item/agentMessage/delta",
        "item/commandExecution/outputDelta",
        "rawResponse/completed"
      ])
    });
    await harness.manager.close();
  });

  it("ingests only bounded managed notifications for the owned thread", async () => {
    const harness = runtimeHarness();
    await harness.manager.prepareResume(launchInput());
    const handlers = harness.openOptions[0];

    await handlers?.onNotification?.({
      method: "item/agentMessage/delta",
      params: {
        threadId: NATIVE_THREAD_ID,
        delta: "must not reach persistence"
      }
    });
    await handlers?.onNotification?.({
      method: "item/started",
      params: {
        threadId: "different-native-thread",
        turnId: "turn-private",
        item: { id: "item-private", type: "commandExecution" }
      }
    });
    await handlers?.onNotification?.({
      method: "item/started",
      params: {
        threadId: NATIVE_THREAD_ID,
        turnId: "turn-private",
        item: {
          id: "item-private",
          type: "commandExecution",
          command: "private command"
        }
      }
    });

    expect(harness.persistenceCalls.map((call) => call.kind)).toEqual([
      "begin",
      "stream_connected",
      "notification"
    ]);
    await harness.manager.close();
  });

  it("downgrades an unexpected close and marks reconnect continuity", async () => {
    const harness = runtimeHarness();
    await harness.manager.prepareResume(launchInput());

    await harness.openOptions[0]?.onClose?.(
      new CodexAppServerWebSocketError(
        "APP_SERVER_CLOSED",
        "sanitized"
      ),
      { expected: false }
    );
    await vi.waitFor(() => {
      expect(
        harness.persistenceCalls.some(
          (call) => call.kind === "stream_disconnected"
        )
      ).toBe(true);
    });

    const resumed = await harness.manager.prepareResume(launchInput());
    expect(resumed.remoteEndpoint).toBe("ws://127.0.0.1:4501");
    expect(
      harness.persistenceCalls.some(
        (call) =>
          call.kind === "stream_reconnected" &&
          call.streamGeneration === STREAM_TWO
      )
    ).toBe(true);
    await harness.manager.close();
  });

  it("does not create a managed run after explicit ownership changes", async () => {
    const harness = runtimeHarness({ ownershipCurrent: false });

    await expect(
      harness.manager.prepareResume(launchInput())
    ).rejects.toMatchObject({ code: "OWNERSHIP_CHANGED" });
    expect(harness.persistenceCalls).toEqual([]);
    await harness.manager.close();
  });

  it("does not reacquire the ownership lease when the launch queue already holds it", async () => {
    const harness = runtimeHarness();
    const launcher = new ManagedCodexResumeLauncher(
      harness.manager,
      {
        focusOrResume: vi.fn(
          async () => "RESUMED_IN_TERMINAL" as const
        )
      },
      { callerHoldsOwnershipLease: true }
    );

    await launcher.focusOrResume(launchInput());

    expect(harness.ownershipChecks()).toBe(0);
    expect(harness.persistenceCalls.map((call) => call.kind)).toEqual([
      "begin",
      "stream_connected"
    ]);
    await harness.manager.close();
  });

  it("ends persisted observation after the explicit binding is revoked", async () => {
    const harness = runtimeHarness();
    await harness.manager.prepareResume(launchInput());
    harness.setOwnershipCurrent(false);

    await harness.openOptions[0]?.onNotification?.({
      method: "turn/started",
      params: {
        threadId: NATIVE_THREAD_ID,
        turn: { id: "private-turn", status: "inProgress" }
      }
    });

    expect(harness.persistenceCalls.map((call) => call.kind)).toEqual([
      "begin",
      "stream_connected",
      "run_closed"
    ]);
    await harness.manager.close();
  });

  it("records a sanitized run failure when Terminal launch fails", async () => {
    const harness = runtimeHarness();
    const terminal = {
      focusOrResume: vi.fn(async () => {
        throw new Error("private Terminal detail");
      })
    };
    const launcher = new ManagedCodexResumeLauncher(
      harness.manager,
      terminal
    );

    await expect(launcher.focusOrResume(launchInput())).rejects.toThrow(
      "private Terminal detail"
    );
    expect(
      harness.persistenceCalls.some((call) => call.kind === "run_failed")
    ).toBe(true);
    expect(JSON.stringify(harness.persistenceCalls)).not.toContain(
      "private Terminal detail"
    );
    await harness.manager.close();
  });
});

function runtimeHarness(input: { ownershipCurrent?: boolean } = {}) {
  const persistenceCalls: Array<{
    kind: string;
    streamGeneration?: string;
  }> = [];
  const persistence: ManagedCodexRuntimePersistence = {
    async begin() {
      persistenceCalls.push({ kind: "begin" });
      return { managedRunId: MANAGED_RUN_ID } as ManagedCodexPublicRunProjection;
    },
    async appendNotification() {
      persistenceCalls.push({ kind: "notification" });
      return { managedRunId: MANAGED_RUN_ID } as ManagedCodexPublicRunProjection;
    },
    async appendStreamEvent(event) {
      persistenceCalls.push({
        kind: event.kind,
        streamGeneration: event.streamGeneration
      });
      return { managedRunId: MANAGED_RUN_ID } as ManagedCodexPublicRunProjection;
    }
  };
  let ownershipCurrent = input.ownershipCurrent !== false;
  let ownershipCheckCount = 0;
  const withCurrentOwnership: ManagedCodexOwnershipExecutor = async (
    _identity,
    mutation
  ) => {
    ownershipCheckCount += 1;
    if (!ownershipCurrent) return { current: false };
    return { current: true, value: await mutation() };
  };
  const sessions: FakeManagedSession[] = [];
  const openOptions: OpenCodexAppServerWebSocketOptions[] = [];
  let streamIndex = 0;
  const streamGenerations = [STREAM_ONE, STREAM_TWO];
  const manager = new ManagedCodexRunManager({
    cwd: "/tmp/blabase-managed-runtime-test",
    ownerInstanceId: OWNER_INSTANCE_ID,
    persistence,
    withCurrentOwnership,
    openSession: async (options) => {
      openOptions.push(options);
      const session = new FakeManagedSession(
        `ws://127.0.0.1:${4500 + sessions.length}`
      );
      sessions.push(session);
      return session;
    },
    now: () => new Date("2026-08-01T03:00:00.000Z"),
    createStreamGeneration: () =>
      streamGenerations[streamIndex++] ?? STREAM_TWO,
    ownershipSweepIntervalMs: 0
  });
  return {
    manager,
    sessions,
    openOptions,
    persistenceCalls,
    ownershipChecks: () => ownershipCheckCount,
    setOwnershipCurrent(value: boolean) {
      ownershipCurrent = value;
    }
  };
}

class FakeManagedSession implements CodexAppServerWebSocketSession {
  readonly initializeResult = { userAgent: "test" };
  readonly requests: Array<{ method: string; params?: unknown }> = [];
  private notificationHandler: CodexAppServerNotificationHandler | null = null;
  private requestHandler: CodexAppServerRequestHandler | null = null;
  private closeHandler: CodexAppServerCloseHandler | null = null;

  constructor(readonly endpoint: string) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({
      method,
      ...(params === undefined ? {} : { params })
    });
    return { thread: { id: NATIVE_THREAD_ID } };
  }

  onNotification(handler: CodexAppServerNotificationHandler): () => void {
    this.notificationHandler = handler;
    return () => {
      if (this.notificationHandler === handler) this.notificationHandler = null;
    };
  }

  onServerRequest(handler: CodexAppServerRequestHandler): () => void {
    this.requestHandler = handler;
    return () => {
      if (this.requestHandler === handler) this.requestHandler = null;
    };
  }

  onClose(handler: CodexAppServerCloseHandler): () => void {
    this.closeHandler = handler;
    return () => {
      if (this.closeHandler === handler) this.closeHandler = null;
    };
  }

  async close(): Promise<void> {
    await this.closeHandler?.(
      new CodexAppServerWebSocketError(
        "APP_SERVER_CLOSED",
        "closed"
      ),
      { expected: true }
    );
  }
}

function launchInput(): ResumeLaunchInput {
  return {
    bindingId: `binding_${"1".repeat(32)}`,
    executionId: `codex:execution:${"2".repeat(24)}`,
    scopeId: "3".repeat(24),
    connectionGeneration: `connection_${"4".repeat(32)}`,
    codexBinaryPath: "/usr/local/bin/codex",
    target: {
      nativeThreadId: NATIVE_THREAD_ID,
      cwd: "/tmp/blabase-project"
    }
  };
}
