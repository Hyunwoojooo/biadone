import { createHash, randomBytes, randomUUID } from "node:crypto";

import { CONTINUATION_MARKER } from "./constants.mjs";

export function makeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function makeOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function makeCorrelationToken({ sessionId, turnId, promptId }) {
  const salt = randomBytes(16).toString("hex");
  return createHash("sha256")
    .update(`${sessionId}\0${turnId}\0${promptId}\0${salt}`, "utf8")
    .digest("base64url");
}

export function formatContinuationPrompt(envelope) {
  return `${CONTINUATION_MARKER}\n${JSON.stringify(envelope)}`;
}

export function parseContinuationPrompt(prompt) {
  if (typeof prompt !== "string" || !prompt.startsWith(`${CONTINUATION_MARKER}\n`)) {
    return null;
  }

  const encoded = prompt.slice(CONTINUATION_MARKER.length + 1);
  if (encoded.length === 0 || encoded.includes(`\n${CONTINUATION_MARKER}\n`)) {
    throw new Error("invalid_continuation_encoding");
  }

  let envelope;
  try {
    envelope = JSON.parse(encoded);
  } catch {
    throw new Error("invalid_continuation_json");
  }

  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.kind !== "blabee_episode_continuation" ||
    !["pet_action", "internal_format_repair"].includes(envelope.continuation_origin) ||
    typeof envelope.continuation_token !== "string" ||
    envelope.continuation_token.length < 16
  ) {
    throw new Error("invalid_continuation_envelope");
  }

  return envelope;
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
