import { adapterError } from "./errors";
import type { RawEnqueuePayload } from "./extractEnqueuePayloads";

export type DecodedStreamChunk = unknown;

export function decodePayloads(
  payloads: RawEnqueuePayload[]
): DecodedStreamChunk[] {
  return payloads.map((payload) => decodePayload(payload.rawArgument, payload.order));
}

export function decodePayload(rawArgument: string, order = 0): DecodedStreamChunk {
  try {
    const firstPass = parseJsLiteral(rawArgument);
    if (typeof firstPass === "string") {
      const trimmed = firstPass.trim();
      if (looksLikeJson(trimmed)) {
        return JSON.parse(trimmed);
      }
      return firstPass;
    }
    return firstPass;
  } catch (error) {
    throw adapterError(
      "PAYLOAD_DECODE_FAILED",
      `Failed to decode enqueue payload at index ${order}`,
      error
    );
  }
}

function parseJsLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return JSON.parse(toJsonStringLiteral(trimmed));
  }
  return JSON.parse(trimmed);
}

function toJsonStringLiteral(singleQuoted: string): string {
  const inner = singleQuoted.slice(1, -1);
  const normalized = inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
  return `"${normalized}"`;
}

function looksLikeJson(value: string): boolean {
  return (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  );
}
