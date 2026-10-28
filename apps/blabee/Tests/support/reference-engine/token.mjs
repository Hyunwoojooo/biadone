import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import { invariant } from "./errors.mjs";
import { deepFreeze } from "./shared.mjs";

const issuedMaterials = new WeakSet();
const issuedHmacKeys = new WeakMap();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const FINGERPRINT_PATTERN = /^(sha256|hmac-sha256):([0-9a-f]{64})$/;
const MAX_TOKEN_BYTES = 768;
const MAX_TOKEN_LENGTH = 1024;

export function constantTimeEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left), "utf8").digest();
  const rightDigest = createHash("sha256").update(String(right), "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function fingerprintToken(token, { hmacKey } = {}) {
  invariant(typeof token === "string" && token.length > 0, "continuation_token_missing");
  if (hmacKey !== undefined) {
    invariant(
      typeof hmacKey === "string" || ArrayBuffer.isView(hmacKey),
      "hmac_key_invalid",
      "hmacKey must be a string or byte view",
    );
    return `hmac-sha256:${createHmac("sha256", hmacKey).update(token, "utf8").digest("hex")}`;
  }
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function verifyTokenFingerprint(token, fingerprint, { hmacKey } = {}) {
  if (typeof token !== "string" || typeof fingerprint !== "string") return false;
  const match = FINGERPRINT_PATTERN.exec(fingerprint);
  if (!match) {
    // Keep malformed inputs on the same digest-and-compare path before failing closed.
    constantTimeEqual(fingerprint, `sha256:${"0".repeat(64)}`);
    return false;
  }
  const algorithm = match[1];
  if (algorithm === "hmac-sha256" && hmacKey === undefined) {
    constantTimeEqual(fingerprint, `hmac-sha256:${"0".repeat(64)}`);
    return false;
  }
  const expected = fingerprintToken(token, algorithm === "hmac-sha256" ? { hmacKey } : {});
  return constantTimeEqual(expected, fingerprint);
}

export function generateTokenMaterial({ bytes = 32, hmacKey } = {}) {
  invariant(Number.isInteger(bytes) && bytes >= 16, "token_entropy_too_low", "tokens need at least 128 bits of entropy");
  invariant(bytes <= MAX_TOKEN_BYTES, "token_size_too_large", "tokens must fit the v1 opaque_token limit");
  const random = nodeRandomBytes(bytes);
  const token = random.toString("base64url");
  invariant(token.length >= 16 && TOKEN_PATTERN.test(token), "generated_token_invalid");
  const material = deepFreeze({
    token,
    entropy_bits: bytes * 8,
    fingerprint: fingerprintToken(token, hmacKey === undefined ? {} : { hmacKey }),
  });
  issuedMaterials.add(material);
  if (hmacKey !== undefined) issuedHmacKeys.set(material, hmacKey);
  return material;
}

export function assertGeneratedTokenMaterial(material) {
  invariant(material && typeof material === "object", "token_material_missing");
  invariant(issuedMaterials.has(material), "token_material_not_csprng_issued");
  invariant(material.entropy_bits >= 128, "token_entropy_too_low");
  invariant(
    typeof material.token === "string" && material.token.length <= MAX_TOKEN_LENGTH,
    "token_size_too_large",
  );
  const hmacKey = issuedHmacKeys.get(material);
  invariant(
    verifyTokenFingerprint(
      material.token,
      material.fingerprint,
      hmacKey === undefined ? {} : { hmacKey },
    ),
    "token_fingerprint_mismatch",
  );
  return material;
}

export function isFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}
