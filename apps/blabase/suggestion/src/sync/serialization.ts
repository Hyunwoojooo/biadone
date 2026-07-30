import { createHash } from "node:crypto";

function normalizeSafeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "safe JSON serialization rejects non-finite numbers"
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSafeValue);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "safe JSON serialization accepts plain objects only"
      );
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new TypeError(
          "safe JSON serialization rejects undefined"
        );
      }
      normalized[key] = normalizeSafeValue(child);
    }
    return normalized;
  }
  throw new TypeError(
    `safe JSON serialization rejects ${typeof value}`
  );
}

export function safeCanonicalJson(value: unknown): string {
  return JSON.stringify(normalizeSafeValue(value));
}

export function safePrettyJson(value: unknown): string {
  return `${JSON.stringify(normalizeSafeValue(value), null, 2)}\n`;
}

export function safeSha256(value: unknown): string {
  return createHash("sha256")
    .update(safeCanonicalJson(value))
    .digest("hex");
}
