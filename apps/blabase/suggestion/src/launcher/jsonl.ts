import { once } from "node:events";
import type { Readable, Writable } from "node:stream";

import {
  LAUNCHER_IPC_CONTRACT,
  launcherIpcErrorResponseSchema,
  launcherIpcRequestSchema,
  launcherIpcSuccessResponseSchema,
  type LauncherIpcRequest,
  type LauncherIpcResponse
} from "./contracts";
import {
  LauncherService,
  LauncherServiceError
} from "./service";

export const MAX_LAUNCHER_IPC_LINE_BYTES = 64 * 1024;

const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const READ_ABORTED = Symbol("launcher IPC read aborted");
const READ_ENDED = Symbol("launcher IPC read ended");

type LauncherRequestHandler = Pick<LauncherService, "handle">;

type LauncherIpcFrame =
  | { kind: "line"; line: string }
  | { kind: "oversized" };

export async function processLauncherIpcLine(
  line: string,
  service: LauncherRequestHandler
): Promise<LauncherIpcResponse> {
  if (Buffer.byteLength(line, "utf8") > MAX_LAUNCHER_IPC_LINE_BYTES) {
    return requestTooLargeResponse();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return errorResponse(
      null,
      "INVALID_JSON",
      "Launcher 요청 JSON 형식을 확인해주세요."
    );
  }
  const requestId = safeRequestId(raw);
  const parsed = launcherIpcRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      "INVALID_REQUEST",
      "Launcher 요청 계약을 확인해주세요."
    );
  }

  try {
    const result = await service.handle(
      parsed.data as LauncherIpcRequest
    );
    return launcherIpcSuccessResponseSchema.parse({
      contract: LAUNCHER_IPC_CONTRACT,
      requestId: parsed.data.requestId,
      ok: true,
      result
    });
  } catch (error) {
    if (error instanceof LauncherServiceError) {
      return errorResponse(
        parsed.data.requestId,
        error.code,
        error.message
      );
    }
    return errorResponse(
      parsed.data.requestId,
      "INTERNAL_ERROR",
      "Launcher 요청을 처리하지 못했습니다."
    );
  }
}

export async function runLauncherJsonlSession(input: {
  readable: Readable;
  writable: Writable;
  service: LauncherRequestHandler;
  signal?: AbortSignal;
}): Promise<void> {
  for await (const frame of readLauncherIpcFrames(
    input.readable,
    input.signal
  )) {
    if (input.signal?.aborted) break;
    const response =
      frame.kind === "oversized"
        ? requestTooLargeResponse()
        : await processLauncherIpcLine(frame.line, input.service);
    await writeJsonLine(input.writable, response);
  }
}

async function* readLauncherIpcFrames(
  readable: Readable,
  signal?: AbortSignal
): AsyncGenerator<LauncherIpcFrame> {
  const lineBuffer = Buffer.allocUnsafe(MAX_LAUNCHER_IPC_LINE_BYTES);
  let lineBytes = 0;
  let oversized = false;
  let skipLineFeed = false;

  const append = (chunk: Buffer, start: number, end: number): void => {
    if (oversized || start === end) return;
    const chunkBytes = end - start;
    if (chunkBytes > MAX_LAUNCHER_IPC_LINE_BYTES - lineBytes) {
      oversized = true;
      lineBytes = 0;
      return;
    }
    chunk.copy(lineBuffer, lineBytes, start, end);
    lineBytes += chunkBytes;
  };

  const finishFrame = (): LauncherIpcFrame => {
    const frame: LauncherIpcFrame = oversized
      ? { kind: "oversized" }
      : {
          kind: "line",
          line: lineBuffer.toString("utf8", 0, lineBytes)
        };
    lineBytes = 0;
    oversized = false;
    return frame;
  };

  while (!signal?.aborted) {
    const next = await readNextChunk(readable, signal);
    if (next === READ_ABORTED) return;
    if (next === READ_ENDED) {
      if (!signal?.aborted && (lineBytes > 0 || oversized)) {
        yield finishFrame();
      }
      return;
    }

    const chunk = normalizeReadableChunk(next);
    let offset = 0;
    if (skipLineFeed && chunk.length > 0) {
      if (chunk[0] === LINE_FEED) offset = 1;
      skipLineFeed = false;
    }

    while (offset < chunk.length) {
      const carriageReturn = chunk.indexOf(CARRIAGE_RETURN, offset);
      const lineFeed = chunk.indexOf(LINE_FEED, offset);
      const delimiter = nextDelimiter(carriageReturn, lineFeed);
      if (delimiter === -1) {
        append(chunk, offset, chunk.length);
        break;
      }

      append(chunk, offset, delimiter);
      const delimiterByte = chunk[delimiter];
      offset = delimiter + 1;

      if (delimiterByte === CARRIAGE_RETURN) {
        if (offset === chunk.length) {
          skipLineFeed = true;
        } else if (chunk[offset] === LINE_FEED) {
          offset += 1;
        }
      }

      yield finishFrame();
      if (signal?.aborted) return;
    }
  }
}

function nextDelimiter(
  carriageReturn: number,
  lineFeed: number
): number {
  if (carriageReturn === -1) return lineFeed;
  if (lineFeed === -1) return carriageReturn;
  return Math.min(carriageReturn, lineFeed);
}

function normalizeReadableChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  throw new TypeError("Launcher IPC input must contain byte or string chunks.");
}

function readNextChunk(
  readable: Readable,
  signal?: AbortSignal
): Promise<unknown | typeof READ_ABORTED | typeof READ_ENDED> {
  if (signal?.aborted) return Promise.resolve(READ_ABORTED);
  const available = readable.read() as unknown;
  if (available !== null) return Promise.resolve(available);
  if (readable.errored) return Promise.reject(readable.errored);
  if (readable.readableEnded || readable.destroyed) {
    return Promise.resolve(READ_ENDED);
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      readable.removeListener("readable", onReadable);
      readable.removeListener("end", onEnd);
      readable.removeListener("close", onClose);
      readable.removeListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (
      value: unknown | typeof READ_ABORTED | typeof READ_ENDED
    ) => {
      cleanup();
      resolve(value);
    };
    const onReadable = () => {
      const chunk = readable.read() as unknown;
      if (chunk !== null) settle(chunk);
    };
    const onEnd = () => settle(READ_ENDED);
    const onClose = () => {
      if (readable.errored) {
        cleanup();
        reject(readable.errored);
      } else {
        settle(READ_ENDED);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => settle(READ_ABORTED);

    readable.on("readable", onReadable);
    readable.once("end", onEnd);
    readable.once("close", onClose);
    readable.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    onReadable();
  });
}

function requestTooLargeResponse(): LauncherIpcResponse {
  return errorResponse(
    null,
    "REQUEST_TOO_LARGE",
    "Launcher 요청 크기 제한을 초과했습니다."
  );
}

function errorResponse(
  requestId: string | null,
  code: string,
  message: string
): LauncherIpcResponse {
  const safeCode = /^[A-Z0-9_]{1,120}$/.test(code)
    ? code
    : "INTERNAL_ERROR";
  return launcherIpcErrorResponseSchema.parse({
    contract: LAUNCHER_IPC_CONTRACT,
    requestId,
    ok: false,
    error: {
      code: safeCode,
      message:
        safeCode === code
          ? message
          : "Launcher 요청을 처리하지 못했습니다."
    }
  });
}

function safeRequestId(raw: unknown): string | null {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("requestId" in raw)
  ) {
    return null;
  }
  const requestId = (raw as { requestId?: unknown }).requestId;
  return typeof requestId === "string" &&
    requestId.length >= 1 &&
    requestId.length <= 120 &&
    /^[A-Za-z0-9._:-]+$/.test(requestId)
    ? requestId
    : null;
}

async function writeJsonLine(
  writable: Writable,
  value: LauncherIpcResponse
): Promise<void> {
  if (writable.write(`${JSON.stringify(value)}\n`)) return;
  await once(writable, "drain");
}
