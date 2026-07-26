import { createHash } from "node:crypto";

function normalizeCanonicalValue(value: unknown): unknown {
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
        "canonical JSON does not support non-finite numbers"
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeCanonicalValue);
  }
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new TypeError(
          "canonical JSON does not support undefined"
        );
      }
      normalized[key] = normalizeCanonicalValue(child);
    }
    return normalized;
  }
  throw new TypeError(
    `canonical JSON does not support ${typeof value}`
  );
}

export function runtimeCanonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function runtimeSha256(value: unknown): string {
  return createHash("sha256")
    .update(runtimeCanonicalJson(value))
    .digest("hex");
}

export function runtimeStableId(
  prefix: string,
  domain: string,
  value: unknown
): string {
  return `${prefix}_${runtimeSha256({ domain, value }).slice(0, 32)}`;
}

export function compareRuntimeStrings(
  left: string,
  right: string
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
