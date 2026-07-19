import { adapterError } from "./errors";

export type RawEnqueuePayload = {
  order: number;
  rawArgument: string;
  startOffset: number;
  endOffset: number;
};

const ENQUEUE_PATTERN = "streamController.enqueue";

export function extractEnqueuePayloads(html: string): RawEnqueuePayload[] {
  const payloads: RawEnqueuePayload[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const patternIndex = html.indexOf(ENQUEUE_PATTERN, cursor);
    if (patternIndex === -1) {
      break;
    }

    const openParen = html.indexOf("(", patternIndex + ENQUEUE_PATTERN.length);
    if (openParen === -1) {
      throw adapterError(
        "PAYLOAD_NOT_FOUND",
        "Found enqueue call without an opening parenthesis"
      );
    }

    const parsed = scanFirstArgument(html, openParen);
    payloads.push({
      order: payloads.length,
      rawArgument: parsed.argument,
      startOffset: openParen + 1,
      endOffset: parsed.endOffset
    });
    cursor = parsed.endOffset + 1;
  }

  if (payloads.length === 0) {
    throw adapterError(
      "PAYLOAD_NOT_FOUND",
      "No streamController.enqueue payloads found"
    );
  }

  return payloads;
}

function scanFirstArgument(
  source: string,
  openParen: number
): { argument: string; endOffset: number } {
  let index = openParen + 1;
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  const start = index;

  for (; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }

    if (char === ")" && depth === 0) {
      return {
        argument: source.slice(start, index).trim(),
        endOffset: index
      };
    }

    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      continue;
    }

    if (char === "," && depth === 0) {
      return {
        argument: source.slice(start, index).trim(),
        endOffset: index
      };
    }
  }

  throw adapterError("PAYLOAD_NOT_FOUND", "Unterminated enqueue call");
}
