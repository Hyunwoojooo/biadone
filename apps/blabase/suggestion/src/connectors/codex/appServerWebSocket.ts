import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { isAbsolute } from "node:path";

import { CODEX_APP_SERVER_TIMEOUT_MS } from "./config";

const RPC_CLIENT_NAME = "blabase_suggestion";
const RPC_CLIENT_TITLE = "blabase Suggestion";
const RPC_CLIENT_VERSION = "0.1.0";
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_CONFIGURED_MESSAGE_BYTES = 16 * 1024 * 1024;
const RETRY_INTERVAL_MS = 50;
const WEB_SOCKET_OPEN = 1;
const WEB_SOCKET_CLOSED = 3;
const UNSAFE_LOCAL_VALUE =
  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

type JsonRpcId = number | string;

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
};

export type CodexAppServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type CodexAppServerNotificationHandler = (
  notification: CodexAppServerNotification
) => void | Promise<void>;

export type CodexAppServerRequestHandler = (
  request: CodexAppServerRequest
) => void | Promise<void>;

export type CodexAppServerCloseHandler = (
  error: CodexAppServerWebSocketError,
  context: { expected: boolean }
) => void | Promise<void>;

export type CodexAppServerWebSocketErrorCode =
  | "INVALID_OPTIONS"
  | "APP_SERVER_START_FAILED"
  | "APP_SERVER_CONNECTION_TIMEOUT"
  | "APP_SERVER_CONNECTION_FAILED"
  | "APP_SERVER_REQUEST_TIMEOUT"
  | "APP_SERVER_MESSAGE_TOO_LARGE"
  | "APP_SERVER_PROTOCOL_ERROR"
  | "APP_SERVER_CLOSED"
  | "APP_SERVER_ABORTED";

export class CodexAppServerWebSocketError extends Error {
  constructor(
    public readonly code: CodexAppServerWebSocketErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CodexAppServerWebSocketError";
  }
}

export interface CodexAppServerWebSocketLike {
  readonly readyState: number;
  binaryType?: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: unknown) => void
  ): void;
}

export type CodexAppServerSpawn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ["ignore", "ignore", "pipe"];
  }
) => ChildProcess;

export type CodexAppServerWebSocketFactory = (
  endpoint: string
) => CodexAppServerWebSocketLike;

export interface CodexAppServerWebSocketSession {
  readonly endpoint: string;
  readonly initializeResult: unknown;
  request(method: string, params?: unknown): Promise<unknown>;
  onNotification(
    handler: CodexAppServerNotificationHandler
  ): () => void;
  onServerRequest(
    handler: CodexAppServerRequestHandler
  ): () => void;
  onClose(handler: CodexAppServerCloseHandler): () => void;
  close(): Promise<void>;
}

export type OpenCodexAppServerWebSocketOptions = {
  binaryPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxMessageBytes?: number;
  getPort?: () => number | Promise<number>;
  spawnProcess?: CodexAppServerSpawn;
  createWebSocket?: CodexAppServerWebSocketFactory;
  initializeCapabilities?: unknown;
  onNotification?: CodexAppServerNotificationHandler;
  onServerRequest?: CodexAppServerRequestHandler;
  onClose?: CodexAppServerCloseHandler;
};

export async function openCodexAppServerWebSocket(
  options: OpenCodexAppServerWebSocketOptions
): Promise<CodexAppServerWebSocketSession> {
  const cwd = validateAbsoluteLocalValue(
    options.cwd ?? process.cwd(),
    "cwd"
  );
  const binaryPath = validateAbsoluteLocalValue(
    options.binaryPath,
    "binaryPath"
  );
  const connectionTimeoutMs = validateTimeout(
    options.connectionTimeoutMs ?? CODEX_APP_SERVER_TIMEOUT_MS
  );
  const requestTimeoutMs = validateTimeout(
    options.requestTimeoutMs ?? CODEX_APP_SERVER_TIMEOUT_MS
  );
  const maxMessageBytes = validateMessageLimit(
    options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  );
  if (options.signal?.aborted) {
    throw abortedError();
  }

  const port = validatePort(
    await (options.getPort ?? reserveLoopbackPort)()
  );
  const endpoint = `ws://${LOOPBACK_HOST}:${port}`;
  assertLoopbackEndpoint(endpoint);

  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  let child: ChildProcess;
  try {
    child = spawnProcess(
      binaryPath,
      ["app-server", "--listen", endpoint],
      {
        cwd,
        env: codexChildEnvironment(options.env),
        shell: false,
        stdio: ["ignore", "ignore", "pipe"]
      }
    );
    child.stderr?.resume();
  } catch {
    throw new CodexAppServerWebSocketError(
      "APP_SERVER_START_FAILED",
      "Codex App Server를 시작하지 못했습니다."
    );
  }

  let socket: CodexAppServerWebSocketLike;
  try {
    socket = await connectWithRetry({
      endpoint,
      child,
      signal: options.signal,
      timeoutMs: connectionTimeoutMs,
      createWebSocket:
        options.createWebSocket ?? defaultWebSocketFactory
    });
  } catch (error) {
    terminateChild(child);
    throw error;
  }

  const session = new WebSocketSession({
    endpoint,
    child,
    socket,
    requestTimeoutMs,
    maxMessageBytes,
    signal: options.signal,
    onNotification: options.onNotification,
    onServerRequest: options.onServerRequest,
    onClose: options.onClose
  });
  try {
    const initializeResult = await session.request("initialize", {
      clientInfo: {
        name: RPC_CLIENT_NAME,
        title: RPC_CLIENT_TITLE,
        version: RPC_CLIENT_VERSION
      },
      ...(options.initializeCapabilities === undefined
        ? {}
        : { capabilities: options.initializeCapabilities })
    });
    session.sendNotification("initialized", {});
    session.setInitializeResult(initializeResult);
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

class WebSocketSession
  implements CodexAppServerWebSocketSession
{
  private nextId = 1;
  private closedError: CodexAppServerWebSocketError | null = null;
  private closeWasExpected = false;
  private initialized: unknown;
  private decodeTail: Promise<void> = Promise.resolve();
  private callbackTail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly notificationHandlers =
    new Set<CodexAppServerNotificationHandler>();
  private readonly serverRequestHandlers =
    new Set<CodexAppServerRequestHandler>();
  private readonly closeHandlers =
    new Set<CodexAppServerCloseHandler>();

  private readonly onMessage = (event: unknown): void => {
    this.decodeTail = this.decodeTail
      .then(async () => {
        const data = messageEventData(event);
        const text = await boundedMessageText(
          data,
          this.options.maxMessageBytes
        );
        this.routeMessage(text);
      })
      .catch((error: unknown) => {
        this.fail(normalizeProtocolError(error));
      });
  };

  private readonly onSocketError = (): void => {
    this.fail(
      new CodexAppServerWebSocketError(
        "APP_SERVER_CONNECTION_FAILED",
        "Codex App Server WebSocket 연결이 실패했습니다."
      )
    );
  };

  private readonly onSocketClose = (): void => {
    this.fail(closedError());
  };

  private readonly onChildError = (): void => {
    this.fail(
      new CodexAppServerWebSocketError(
        "APP_SERVER_START_FAILED",
        "Codex App Server 실행 중 오류가 발생했습니다."
      )
    );
  };

  private readonly onChildExit = (): void => {
    this.fail(closedError());
  };

  private readonly onAbort = (): void => {
    this.fail(abortedError());
  };

  constructor(
    private readonly options: {
      endpoint: string;
      child: ChildProcess;
      socket: CodexAppServerWebSocketLike;
      requestTimeoutMs: number;
      maxMessageBytes: number;
      signal?: AbortSignal;
      onNotification?: CodexAppServerNotificationHandler;
      onServerRequest?: CodexAppServerRequestHandler;
      onClose?: CodexAppServerCloseHandler;
    }
  ) {
    if (options.onNotification) {
      this.notificationHandlers.add(options.onNotification);
    }
    if (options.onServerRequest) {
      this.serverRequestHandlers.add(options.onServerRequest);
    }
    if (options.onClose) {
      this.closeHandlers.add(options.onClose);
    }
    options.socket.addEventListener("message", this.onMessage);
    options.socket.addEventListener("error", this.onSocketError);
    options.socket.addEventListener("close", this.onSocketClose);
    options.child.on("error", this.onChildError);
    options.child.on("exit", this.onChildExit);
    options.signal?.addEventListener("abort", this.onAbort, {
      once: true
    });
  }

  get endpoint(): string {
    return this.options.endpoint;
  }

  get initializeResult(): unknown {
    return this.initialized;
  }

  setInitializeResult(result: unknown): void {
    this.initialized = result;
  }

  request(methodInput: string, params?: unknown): Promise<unknown> {
    const method = validateMethod(methodInput);
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CodexAppServerWebSocketError(
            "APP_SERVER_REQUEST_TIMEOUT",
            "Codex App Server 요청 시간이 초과되었습니다."
          )
        );
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.sendMessage({
          id,
          method,
          ...(params === undefined ? {} : { params })
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  onNotification(
    handler: CodexAppServerNotificationHandler
  ): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(
    handler: CodexAppServerRequestHandler
  ): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  onClose(handler: CodexAppServerCloseHandler): () => void {
    if (this.closedError) {
      const error = this.closedError;
      const expected = this.closeWasExpected;
      queueMicrotask(() => {
        invokeCloseHandler(handler, error, expected);
      });
      return () => undefined;
    }
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async close(): Promise<void> {
    this.shutdown(closedError(), true);
  }

  sendNotification(methodInput: string, params?: unknown): void {
    this.sendMessage({
      method: validateMethod(methodInput),
      ...(params === undefined ? {} : { params })
    });
  }

  private sendMessage(message: object): void {
    if (this.closedError) throw this.closedError;
    if (this.options.socket.readyState !== WEB_SOCKET_OPEN) {
      throw closedError();
    }
    const serialized = JSON.stringify(message);
    if (
      Buffer.byteLength(serialized, "utf8") >
      this.options.maxMessageBytes
    ) {
      const error = messageTooLargeError();
      this.fail(error);
      throw error;
    }
    this.options.socket.send(serialized);
  }

  private routeMessage(text: string): void {
    if (this.closedError) return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      throw new CodexAppServerWebSocketError(
        "APP_SERVER_PROTOCOL_ERROR",
        "Codex App Server가 올바르지 않은 JSON을 보냈습니다."
      );
    }
    if (!message || typeof message !== "object") {
      throw protocolError();
    }
    const record = message as Record<string, unknown>;
    const method =
      typeof record.method === "string" && record.method.length > 0
        ? record.method
        : null;
    const hasId = Object.prototype.hasOwnProperty.call(record, "id");

    if (method && hasId) {
      const id = parseJsonRpcId(record.id);
      this.enqueueServerRequest({
        id,
        method,
        ...(Object.prototype.hasOwnProperty.call(record, "params")
          ? { params: record.params }
          : {})
      });
      return;
    }
    if (method && !hasId) {
      this.enqueueNotification({
        method,
        ...(Object.prototype.hasOwnProperty.call(record, "params")
          ? { params: record.params }
          : {})
      });
      return;
    }
    if (!hasId) throw protocolError();

    const id = parseJsonRpcId(record.id);
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (Object.prototype.hasOwnProperty.call(record, "error")) {
      pending.reject(
        new CodexAppServerWebSocketError(
          "APP_SERVER_PROTOCOL_ERROR",
          "Codex App Server 요청이 거부되었습니다."
        )
      );
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(record, "result")) {
      pending.reject(protocolError());
      return;
    }
    pending.resolve(record.result);
  }

  private enqueueNotification(
    notification: CodexAppServerNotification
  ): void {
    const handlers = [...this.notificationHandlers];
    this.enqueueCallbacks(() => handlers, notification);
  }

  private enqueueServerRequest(
    request: CodexAppServerRequest
  ): void {
    const handlers = [...this.serverRequestHandlers];
    this.enqueueCallbacks(() => handlers, request);
  }

  private enqueueCallbacks<T>(
    handlers: () => Array<(value: T) => void | Promise<void>>,
    value: T
  ): void {
    this.callbackTail = this.callbackTail
      .then(async () => {
        if (this.closedError) return;
        for (const handler of handlers()) {
          if (this.closedError) return;
          await handler(value);
        }
      })
      .catch(() => {
        this.fail(protocolError());
      });
  }

  private fail(error: CodexAppServerWebSocketError): void {
    this.shutdown(error, false);
  }

  private shutdown(
    error: CodexAppServerWebSocketError,
    expected: boolean
  ): void {
    if (this.closedError) return;
    this.closedError = error;
    this.closeWasExpected = expected;
    const closeHandlers = [...this.closeHandlers];
    this.closeHandlers.clear();
    this.options.signal?.removeEventListener("abort", this.onAbort);
    this.options.socket.removeEventListener("message", this.onMessage);
    this.options.socket.removeEventListener("error", this.onSocketError);
    this.options.socket.removeEventListener("close", this.onSocketClose);
    this.options.child.off("error", this.onChildError);
    this.options.child.off("exit", this.onChildExit);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.options.socket.readyState !== WEB_SOCKET_CLOSED) {
      try {
        this.options.socket.close();
      } catch {
        // The child cleanup below remains authoritative.
      }
    }
    terminateChild(this.options.child);
    for (const handler of closeHandlers) {
      invokeCloseHandler(handler, error, expected);
    }
  }
}

async function connectWithRetry(input: {
  endpoint: string;
  child: ChildProcess;
  signal?: AbortSignal;
  timeoutMs: number;
  createWebSocket: CodexAppServerWebSocketFactory;
}): Promise<CodexAppServerWebSocketLike> {
  const deadline = Date.now() + input.timeoutMs;
  let childFailure: CodexAppServerWebSocketError | null = null;
  const lifecycleAbort = new AbortController();
  const onChildError = () => {
    childFailure = new CodexAppServerWebSocketError(
      "APP_SERVER_START_FAILED",
      "Codex App Server를 시작하지 못했습니다."
    );
    lifecycleAbort.abort();
  };
  const onChildExit = () => {
    childFailure = new CodexAppServerWebSocketError(
      "APP_SERVER_CONNECTION_FAILED",
      "Codex App Server가 연결 전에 종료되었습니다."
    );
    lifecycleAbort.abort();
  };
  const onExternalAbort = () => lifecycleAbort.abort();
  input.child.on("error", onChildError);
  input.child.on("exit", onChildExit);
  input.signal?.addEventListener("abort", onExternalAbort, {
    once: true
  });
  if (input.signal?.aborted) lifecycleAbort.abort();
  try {
    while (Date.now() < deadline) {
      if (input.signal?.aborted) throw abortedError();
      if (childFailure) throw childFailure;
      const remaining = deadline - Date.now();
      try {
        return await connectAttempt(
          input.endpoint,
          input.createWebSocket,
          lifecycleAbort.signal,
          remaining
        );
      } catch (error) {
        if (input.signal?.aborted) throw abortedError();
        if (childFailure) throw childFailure;
        if (
          error instanceof CodexAppServerWebSocketError &&
          error.code === "APP_SERVER_ABORTED"
        ) {
          throw error;
        }
        const retryRemaining = deadline - Date.now();
        if (retryRemaining <= 0) break;
        await waitForRetry(
          Math.min(RETRY_INTERVAL_MS, retryRemaining),
          input.signal
        );
      }
    }
    throw new CodexAppServerWebSocketError(
      "APP_SERVER_CONNECTION_TIMEOUT",
      "Codex App Server WebSocket 연결 시간이 초과되었습니다."
    );
  } finally {
    input.child.off("error", onChildError);
    input.child.off("exit", onChildExit);
    input.signal?.removeEventListener("abort", onExternalAbort);
  }
}

function connectAttempt(
  endpoint: string,
  createWebSocket: CodexAppServerWebSocketFactory,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<CodexAppServerWebSocketLike> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    let socket: CodexAppServerWebSocketLike;
    try {
      socket = createWebSocket(endpoint);
      if ("binaryType" in socket) socket.binaryType = "arraybuffer";
    } catch {
      reject(
        new CodexAppServerWebSocketError(
          "APP_SERVER_CONNECTION_FAILED",
          "Codex App Server WebSocket을 만들지 못했습니다."
        )
      );
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      finish(
        new CodexAppServerWebSocketError(
          "APP_SERVER_CONNECTION_TIMEOUT",
          "Codex App Server WebSocket 연결 시간이 초과되었습니다."
        )
      );
    }, timeoutMs);
    const onOpen = () => finish(null);
    const onError = () =>
      finish(
        new CodexAppServerWebSocketError(
          "APP_SERVER_CONNECTION_FAILED",
          "Codex App Server WebSocket 연결이 실패했습니다."
        )
      );
    const onClose = () => onError();
    const onAbort = () => finish(abortedError());
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(
      error: CodexAppServerWebSocketError | null
    ): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        try {
          socket.close();
        } catch {
          // The failed attempt has no remaining resources to expose.
        }
        reject(error);
        return;
      }
      resolve(socket);
    }
  });
}

function waitForRetry(
  durationMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortedError());
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    function onAbort(): void {
      cleanup();
      reject(abortedError());
    }
    function cleanup(): void {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    function finish(): void {
      cleanup();
      resolve();
    }
    timeout = setTimeout(finish, durationMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function boundedMessageText(
  data: unknown,
  maxBytes: number
): Promise<string> {
  if (typeof data === "string") {
    if (Buffer.byteLength(data, "utf8") > maxBytes) {
      throw messageTooLargeError();
    }
    return data;
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > maxBytes) throw messageTooLargeError();
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    if (data.byteLength > maxBytes) throw messageTooLargeError();
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    if (data.size > maxBytes) throw messageTooLargeError();
    return data.text();
  }
  throw protocolError();
}

function messageEventData(event: unknown): unknown {
  if (
    event &&
    typeof event === "object" &&
    "data" in event
  ) {
    return (event as { data: unknown }).data;
  }
  throw protocolError();
}

function parseJsonRpcId(input: unknown): JsonRpcId {
  if (
    (typeof input === "number" && Number.isSafeInteger(input)) ||
    (typeof input === "string" && input.length > 0)
  ) {
    return input;
  }
  throw protocolError();
}

function validateMethod(input: string): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 240 ||
    UNSAFE_LOCAL_VALUE.test(input)
  ) {
    throw new CodexAppServerWebSocketError(
      "INVALID_OPTIONS",
      "Codex App Server method가 올바르지 않습니다."
    );
  }
  return input;
}

function validateAbsoluteLocalValue(
  input: string,
  label: string
): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 4096 ||
    !isAbsolute(input) ||
    UNSAFE_LOCAL_VALUE.test(input)
  ) {
    throw new CodexAppServerWebSocketError(
      "INVALID_OPTIONS",
      `Codex App Server ${label}가 올바르지 않습니다.`
    );
  }
  return input;
}

function validateTimeout(input: number): number {
  if (!Number.isFinite(input) || input < 1 || input > 120_000) {
    throw new CodexAppServerWebSocketError(
      "INVALID_OPTIONS",
      "Codex App Server timeout이 올바르지 않습니다."
    );
  }
  return Math.floor(input);
}

function validateMessageLimit(input: number): number {
  if (
    !Number.isFinite(input) ||
    input < 1024 ||
    input > MAX_CONFIGURED_MESSAGE_BYTES
  ) {
    throw new CodexAppServerWebSocketError(
      "INVALID_OPTIONS",
      "Codex App Server message limit이 올바르지 않습니다."
    );
  }
  return Math.floor(input);
}

function validatePort(input: number): number {
  if (!Number.isInteger(input) || input < 1 || input > 65_535) {
    throw new CodexAppServerWebSocketError(
      "INVALID_OPTIONS",
      "Codex App Server loopback port가 올바르지 않습니다."
    );
  }
  return input;
}

function assertLoopbackEndpoint(endpoint: string): void {
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== "ws:" ||
    parsed.hostname !== LOOPBACK_HOST ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new CodexAppServerWebSocketError(
      "INVALID_OPTIONS",
      "Codex App Server endpoint는 local loopback이어야 합니다."
    );
  }
}

function codexChildEnvironment(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const allowedKeys = [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SHELL",
    "CODEX_HOME",
    "CODEX_SQLITE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME"
  ];
  return {
    NODE_ENV: env.NODE_ENV ?? "development",
    ...Object.fromEntries(
      allowedKeys.flatMap((key) =>
        env[key] ? [[key, env[key]]] : []
      )
    )
  };
}

function defaultSpawn(
  command: string,
  args: string[],
  options: Parameters<CodexAppServerSpawn>[2]
): ChildProcess {
  return spawn(command, args, options);
}

function defaultWebSocketFactory(
  endpoint: string
): CodexAppServerWebSocketLike {
  if (typeof WebSocket === "undefined") {
    throw new CodexAppServerWebSocketError(
      "APP_SERVER_CONNECTION_FAILED",
      "현재 runtime에서 WebSocket을 사용할 수 없습니다."
    );
  }
  return new WebSocket(endpoint) as unknown as CodexAppServerWebSocketLike;
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : null;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return validatePort(port ?? 0);
}

function terminateChild(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // There is no provider error detail to retain or expose.
  }
}

function normalizeProtocolError(
  error: unknown
): CodexAppServerWebSocketError {
  return error instanceof CodexAppServerWebSocketError
    ? error
    : protocolError();
}

function protocolError(): CodexAppServerWebSocketError {
  return new CodexAppServerWebSocketError(
    "APP_SERVER_PROTOCOL_ERROR",
    "Codex App Server WebSocket 메시지를 해석하지 못했습니다."
  );
}

function messageTooLargeError(): CodexAppServerWebSocketError {
  return new CodexAppServerWebSocketError(
    "APP_SERVER_MESSAGE_TOO_LARGE",
    "Codex App Server WebSocket 메시지가 허용 범위를 넘었습니다."
  );
}

function closedError(): CodexAppServerWebSocketError {
  return new CodexAppServerWebSocketError(
    "APP_SERVER_CLOSED",
    "Codex App Server WebSocket 연결이 종료되었습니다."
  );
}

function abortedError(): CodexAppServerWebSocketError {
  return new CodexAppServerWebSocketError(
    "APP_SERVER_ABORTED",
    "Codex App Server WebSocket 연결이 중단되었습니다."
  );
}

function invokeCloseHandler(
  handler: CodexAppServerCloseHandler,
  error: CodexAppServerWebSocketError,
  expected: boolean
): void {
  try {
    void Promise.resolve(handler(error, { expected })).catch(
      () => undefined
    );
  } catch {
    // Close observers cannot reopen or destabilize the transport boundary.
  }
}
