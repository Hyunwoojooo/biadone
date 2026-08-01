import { randomBytes } from "node:crypto";

import {
  openCodexAppServerWebSocket,
  type CodexAppServerNotification,
  type CodexAppServerWebSocketSession,
  type OpenCodexAppServerWebSocketOptions
} from "../connectors/codex/appServerWebSocket";
import {
  isManagedCodexOwnershipCurrent,
  withWorkResumptionStateLease
} from "../resumption/store";
import type {
  CodexResumeLauncher,
  ResumeLaunchInput
} from "../resumption/companion/types";
import {
  appendManagedCodexNotification,
  appendManagedCodexStreamEvent,
  beginManagedCodexRun,
  ManagedCodexStoreError,
  type AppendManagedCodexNotificationInput,
  type AppendManagedCodexStreamEventInput
} from "./store";
import type {
  BeginManagedCodexRunInput,
  ManagedCodexPublicRunProjection
} from "./contracts";

const OWNERSHIP_SWEEP_INTERVAL_MS = 3_000;
const MANAGED_MESSAGE_LIMIT_BYTES = 4 * 1024 * 1024;

const MANAGED_NOTIFICATION_METHODS = new Set([
  "thread/status/changed",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed"
]);

const MANAGED_NOTIFICATION_OPT_OUT = [
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "turn/diff/updated",
  "thread/tokenUsage/updated",
  "rawResponseItem/completed",
  "rawResponse/completed"
] as const;

type ManagedIdentity = {
  bindingId: string;
  executionId: string;
  scopeId: string;
  connectionGeneration: string;
};

type ManagedRunContext = ManagedIdentity & {
  managedRunId: string;
  nativeThreadId: string;
  streamGeneration: string;
  streamState: "connecting" | "connected" | "disconnected";
};

type OwnershipResult<T> =
  | { current: true; value: T }
  | { current: false };

export type ManagedCodexRuntimePersistence = {
  begin(
    input: BeginManagedCodexRunInput,
    cwd: string
  ): Promise<ManagedCodexPublicRunProjection>;
  appendNotification(
    input: AppendManagedCodexNotificationInput,
    cwd: string
  ): Promise<ManagedCodexPublicRunProjection>;
  appendStreamEvent(
    input: AppendManagedCodexStreamEventInput,
    cwd: string
  ): Promise<ManagedCodexPublicRunProjection>;
};

export type ManagedCodexOwnershipExecutor = <T>(
  identity: ManagedIdentity,
  mutation: () => Promise<T>
) => Promise<OwnershipResult<T>>;

export type ManagedCodexRuntimeErrorCode =
  | "MANAGER_CLOSED"
  | "OWNERSHIP_CHANGED"
  | "THREAD_ALREADY_MANAGED"
  | "APP_SERVER_UNAVAILABLE"
  | "MANAGED_RUN_FAILED";

export class ManagedCodexRuntimeError extends Error {
  constructor(
    public readonly code: ManagedCodexRuntimeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ManagedCodexRuntimeError";
  }
}

export type PreparedManagedCodexResume = {
  managedRunId: string;
  remoteEndpoint: string;
};

type ManagedCodexOwnershipAccess = {
  callerHoldsOwnershipLease?: boolean;
};

export class ManagedCodexRunManager {
  private session: CodexAppServerWebSocketSession | null = null;
  private sessionBinaryPath: string | null = null;
  private sessionEpoch = 0;
  private sessionFlight: Promise<CodexAppServerWebSocketSession> | null =
    null;
  private ingestTail: Promise<void> = Promise.resolve();
  private readonly runsByBinding = new Map<string, ManagedRunContext>();
  private readonly runsByNativeThread = new Map<
    string,
    ManagedRunContext
  >();
  private readonly ownershipTimer: ReturnType<typeof setInterval> | null;
  private closed = false;

  constructor(
    private readonly options: {
      cwd: string;
      ownerInstanceId: string;
      openSession?: (
        options: OpenCodexAppServerWebSocketOptions
      ) => Promise<CodexAppServerWebSocketSession>;
      persistence?: ManagedCodexRuntimePersistence;
      withCurrentOwnership?: ManagedCodexOwnershipExecutor;
      now?: () => Date;
      createStreamGeneration?: () => string;
      ownershipSweepIntervalMs?: number;
    }
  ) {
    const interval =
      options.ownershipSweepIntervalMs ??
      OWNERSHIP_SWEEP_INTERVAL_MS;
    if (interval > 0) {
      this.ownershipTimer = setInterval(() => {
        this.enqueueIngest(() => this.sweepOwnership());
      }, interval);
      this.ownershipTimer.unref?.();
    } else {
      this.ownershipTimer = null;
    }
  }

  async prepareResume(
    input: ResumeLaunchInput,
    access: ManagedCodexOwnershipAccess = {}
  ): Promise<PreparedManagedCodexResume> {
    this.assertOpen();
    const identity = identityFromLaunch(input);
    const existing = this.runsByBinding.get(input.bindingId);
    if (existing) {
      if (!sameIdentity(existing, identity)) {
        throw new ManagedCodexRuntimeError(
          "THREAD_ALREADY_MANAGED",
          "현재 binding의 managed Codex 실행 소유권이 일치하지 않습니다."
        );
      }
      const session = await this.ensureSession(input.codexBinaryPath);
      if (existing.streamState !== "connected") {
        await this.reconnectRun(
          existing,
          session,
          access.callerHoldsOwnershipLease === true
        );
      }
      return {
        managedRunId: existing.managedRunId,
        remoteEndpoint: session.endpoint
      };
    }

    const threadOwner = this.runsByNativeThread.get(
      input.target.nativeThreadId
    );
    if (threadOwner) {
      throw new ManagedCodexRuntimeError(
        "THREAD_ALREADY_MANAGED",
        "동일한 Codex thread가 다른 explicit binding에서 관찰 중입니다."
      );
    }

    const session = await this.ensureSession(input.codexBinaryPath);
    const startedAt = this.nowIso();
    const streamGeneration = this.createStreamGeneration();
    const begun = await this.mutateIfCurrent(identity, () =>
      this.persistence.begin(
        {
          ...identity,
          ownerInstanceId: this.options.ownerInstanceId,
          streamGeneration,
          startedAt,
          startedBy: "explicit_user",
          ownership: "blabase_app_server"
        },
        this.options.cwd
      ),
      access.callerHoldsOwnershipLease === true
    );
    if (!begun.current) throw ownershipChangedError();

    const context: ManagedRunContext = {
      ...identity,
      managedRunId: begun.value.managedRunId,
      nativeThreadId: input.target.nativeThreadId,
      streamGeneration,
      streamState: "connecting"
    };
    this.runsByBinding.set(context.bindingId, context);
    this.runsByNativeThread.set(context.nativeThreadId, context);

    try {
      await session.request("thread/resume", {
        threadId: context.nativeThreadId
      });
      const connected = await this.appendStreamEventIfCurrent(
        context,
        {
          kind: "stream_connected",
          observedAt: this.nowIso()
        },
        access.callerHoldsOwnershipLease === true
      );
      if (!connected) throw ownershipChangedError();
      context.streamState = "connected";
      return {
        managedRunId: context.managedRunId,
        remoteEndpoint: session.endpoint
      };
    } catch (error) {
      await this.failRun(
        context,
        access.callerHoldsOwnershipLease === true
      ).catch(() => undefined);
      this.removeRun(context);
      if (error instanceof ManagedCodexRuntimeError) throw error;
      throw new ManagedCodexRuntimeError(
        "APP_SERVER_UNAVAILABLE",
        "Codex App Server에서 managed thread를 시작하지 못했습니다."
      );
    }
  }

  async failPreparedRun(
    managedRunId: string,
    access: ManagedCodexOwnershipAccess = {}
  ): Promise<void> {
    const context = [...this.runsByBinding.values()].find(
      (run) => run.managedRunId === managedRunId
    );
    if (!context) return;
    await this.failRun(
      context,
      access.callerHoldsOwnershipLease === true
    ).catch(() => undefined);
    this.removeRun(context);
    await this.closeSessionWhenIdle();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownershipTimer) clearInterval(this.ownershipTimer);
    await this.ingestTail.catch(() => undefined);
    for (const context of [...this.runsByBinding.values()]) {
      await this.appendStreamEventIfCurrent(context, {
        kind: "run_closed",
        observedAt: this.nowIso()
      }).catch(() => false);
      this.removeRun(context);
    }
    await this.closeSession();
  }

  private get persistence(): ManagedCodexRuntimePersistence {
    return this.options.persistence ?? DEFAULT_PERSISTENCE;
  }

  private get withCurrentOwnership(): ManagedCodexOwnershipExecutor {
    return (
      this.options.withCurrentOwnership ??
      defaultOwnershipExecutor(this.options.cwd)
    );
  }

  private async ensureSession(
    binaryPath: string
  ): Promise<CodexAppServerWebSocketSession> {
    if (this.session) {
      if (this.sessionBinaryPath !== binaryPath) {
        throw new ManagedCodexRuntimeError(
          "APP_SERVER_UNAVAILABLE",
          "실행 중인 managed App Server의 Codex binary가 변경되었습니다."
        );
      }
      return this.session;
    }
    if (this.sessionFlight) return this.sessionFlight;
    const epoch = ++this.sessionEpoch;
    const openSession =
      this.options.openSession ?? openCodexAppServerWebSocket;
    const flight = openSession({
      binaryPath,
      cwd: this.options.cwd,
      maxMessageBytes: MANAGED_MESSAGE_LIMIT_BYTES,
      initializeCapabilities: {
        optOutNotificationMethods: [...MANAGED_NOTIFICATION_OPT_OUT]
      },
      onNotification: (notification) => {
        if (epoch !== this.sessionEpoch || this.closed) return;
        return this.enqueueIngest(() =>
          this.handleNotification(notification)
        );
      },
      onServerRequest: () => {
        // Observation connections never approve, decline, or answer on the
        // user's behalf. The remote TUI that initiated the turn owns requests.
      },
      onClose: (_error, closeContext) => {
        if (
          epoch !== this.sessionEpoch ||
          closeContext.expected ||
          this.closed
        ) {
          return;
        }
        this.session = null;
        this.sessionBinaryPath = null;
        return this.enqueueIngest(() => this.handleUnexpectedClose());
      }
    })
      .then((session) => {
        if (this.closed || epoch !== this.sessionEpoch) {
          void session.close();
          throw new ManagedCodexRuntimeError(
            "MANAGER_CLOSED",
            "Managed Codex manager가 종료되었습니다."
          );
        }
        this.session = session;
        this.sessionBinaryPath = binaryPath;
        return session;
      })
      .finally(() => {
        if (this.sessionFlight === flight) this.sessionFlight = null;
      });
    this.sessionFlight = flight;
    return flight;
  }

  private async reconnectRun(
    context: ManagedRunContext,
    session: CodexAppServerWebSocketSession,
    callerHoldsOwnershipLease: boolean
  ): Promise<void> {
    const nextStreamGeneration = this.createStreamGeneration();
    await session.request("thread/resume", {
      threadId: context.nativeThreadId
    });
    const previousGeneration = context.streamGeneration;
    context.streamGeneration = nextStreamGeneration;
    const reconnected = await this.appendStreamEventIfCurrent(
      context,
      {
        kind: "stream_reconnected",
        observedAt: this.nowIso()
      },
      callerHoldsOwnershipLease
    );
    if (!reconnected) {
      context.streamGeneration = previousGeneration;
      throw ownershipChangedError();
    }
    context.streamState = "connected";
  }

  private async handleNotification(
    notification: CodexAppServerNotification
  ): Promise<void> {
    if (!MANAGED_NOTIFICATION_METHODS.has(notification.method)) return;
    const nativeThreadId = notificationThreadId(notification);
    if (!nativeThreadId) return;
    const context = this.runsByNativeThread.get(nativeThreadId);
    if (!context || context.streamState !== "connected") return;
    const current = await this.withCurrentOwnership(context, () =>
      this.persistence.appendNotification(
        {
          managedRunId: context.managedRunId,
          ownerInstanceId: this.options.ownerInstanceId,
          expectedThreadId: context.nativeThreadId,
          notification,
          observedAt: this.nowIso()
        },
        this.options.cwd
      )
    );
    if (!current.current) {
      await this.closeRevokedRun(context).catch(() => undefined);
      this.removeRun(context);
      await this.closeSessionWhenIdle();
      return;
    }
  }

  private async handleUnexpectedClose(): Promise<void> {
    for (const context of [...this.runsByBinding.values()]) {
      if (context.streamState !== "connected") continue;
      await this.appendStreamEventIfCurrent(context, {
        kind: "stream_disconnected",
        observedAt: this.nowIso()
      }).catch(() => false);
      context.streamState = "disconnected";
    }
  }

  private async sweepOwnership(): Promise<void> {
    for (const context of [...this.runsByBinding.values()]) {
      const current = await this.withCurrentOwnership(
        context,
        async () => true
      );
      if (!current.current) {
        await this.closeRevokedRun(context).catch(() => undefined);
        this.removeRun(context);
      }
    }
    await this.closeSessionWhenIdle();
  }

  private async failRun(
    context: ManagedRunContext,
    callerHoldsOwnershipLease = false
  ): Promise<void> {
    await this.appendStreamEventIfCurrent(
      context,
      {
        kind: "run_failed",
        observedAt: this.nowIso()
      },
      callerHoldsOwnershipLease
    );
  }

  private async closeRevokedRun(
    context: ManagedRunContext
  ): Promise<void> {
    await this.persistence.appendStreamEvent(
      {
        managedRunId: context.managedRunId,
        ownerInstanceId: this.options.ownerInstanceId,
        streamGeneration: context.streamGeneration,
        kind: "run_closed",
        observedAt: this.nowIso()
      },
      this.options.cwd
    );
  }

  private appendStreamEventIfCurrent(
    context: ManagedRunContext,
    input: {
      kind: AppendManagedCodexStreamEventInput["kind"];
      observedAt: string;
    },
    callerHoldsOwnershipLease = false
  ): Promise<boolean> {
    return this.mutateIfCurrent(context, () =>
      this.persistence.appendStreamEvent(
        {
          managedRunId: context.managedRunId,
          ownerInstanceId: this.options.ownerInstanceId,
          streamGeneration: context.streamGeneration,
          kind: input.kind,
          observedAt: input.observedAt
        },
        this.options.cwd
      ),
      callerHoldsOwnershipLease
    ).then((result) => result.current);
  }

  private mutateIfCurrent<T>(
    identity: ManagedIdentity,
    mutation: () => Promise<T>,
    callerHoldsOwnershipLease: boolean
  ): Promise<OwnershipResult<T>> {
    if (callerHoldsOwnershipLease) {
      return mutation().then((value) => ({
        current: true,
        value
      }));
    }
    return this.withCurrentOwnership(identity, mutation);
  }

  private removeRun(context: ManagedRunContext): void {
    if (this.runsByBinding.get(context.bindingId) === context) {
      this.runsByBinding.delete(context.bindingId);
    }
    if (
      this.runsByNativeThread.get(context.nativeThreadId) === context
    ) {
      this.runsByNativeThread.delete(context.nativeThreadId);
    }
  }

  private async closeSessionWhenIdle(): Promise<void> {
    if (this.runsByBinding.size === 0) await this.closeSession();
  }

  private async closeSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    this.sessionBinaryPath = null;
    ++this.sessionEpoch;
    await session.close();
  }

  private enqueueIngest(operation: () => Promise<void>): Promise<void> {
    const next = this.ingestTail
      .catch(() => undefined)
      .then(operation);
    this.ingestTail = next.catch(() => undefined);
    return next;
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  private createStreamGeneration(): string {
    const value = (
      this.options.createStreamGeneration ??
      (() => `stream_${randomBytes(16).toString("hex")}`)
    )();
    if (!/^stream_[a-f0-9]{32}$/.test(value)) {
      throw new ManagedCodexRuntimeError(
        "MANAGED_RUN_FAILED",
        "Managed Codex stream generation을 만들지 못했습니다."
      );
    }
    return value;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ManagedCodexRuntimeError(
        "MANAGER_CLOSED",
        "Managed Codex manager가 종료되었습니다."
      );
    }
  }
}

export class ManagedCodexResumeLauncher implements CodexResumeLauncher {
  constructor(
    private readonly manager: ManagedCodexRunManager,
    private readonly terminal: CodexResumeLauncher,
    private readonly options: {
      callerHoldsOwnershipLease?: boolean;
    } = {}
  ) {}

  async focusOrResume(
    input: ResumeLaunchInput
  ): Promise<"FOCUSED_EXISTING" | "RESUMED_IN_TERMINAL"> {
    const access = {
      callerHoldsOwnershipLease:
        this.options.callerHoldsOwnershipLease === true
    };
    const prepared = await this.manager.prepareResume(input, access);
    try {
      return await this.terminal.focusOrResume({
        ...input,
        remoteEndpoint: prepared.remoteEndpoint
      });
    } catch (error) {
      await this.manager
        .failPreparedRun(prepared.managedRunId, access)
        .catch(() => undefined);
      throw error;
    }
  }
}

const DEFAULT_PERSISTENCE: ManagedCodexRuntimePersistence = {
  begin: beginManagedCodexRun,
  appendNotification: appendManagedCodexNotification,
  appendStreamEvent: appendManagedCodexStreamEvent
};

function defaultOwnershipExecutor(
  cwd: string
): ManagedCodexOwnershipExecutor {
  return async <T>(identity: ManagedIdentity, mutation: () => Promise<T>) =>
    withWorkResumptionStateLease(cwd, async () => {
      if (!(await isManagedCodexOwnershipCurrent(identity, cwd))) {
        return { current: false } as const;
      }
      return { current: true, value: await mutation() } as const;
    });
}

function identityFromLaunch(input: ResumeLaunchInput): ManagedIdentity {
  return {
    bindingId: input.bindingId,
    executionId: input.executionId,
    scopeId: input.scopeId,
    connectionGeneration: input.connectionGeneration
  };
}

function sameIdentity(
  left: ManagedIdentity,
  right: ManagedIdentity
): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.executionId === right.executionId &&
    left.scopeId === right.scopeId &&
    left.connectionGeneration === right.connectionGeneration
  );
}

function notificationThreadId(
  notification: CodexAppServerNotification
): string | null {
  const params = notification.params;
  if (!params || typeof params !== "object" || !("threadId" in params)) {
    return null;
  }
  const threadId = (params as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0
    ? threadId
    : null;
}

function ownershipChangedError(): ManagedCodexRuntimeError {
  return new ManagedCodexRuntimeError(
    "OWNERSHIP_CHANGED",
    "Explicit binding 또는 Codex 연결이 변경되었습니다."
  );
}

export function isManagedCodexRuntimeError(
  error: unknown
): error is ManagedCodexRuntimeError | ManagedCodexStoreError {
  return (
    error instanceof ManagedCodexRuntimeError ||
    error instanceof ManagedCodexStoreError
  );
}
