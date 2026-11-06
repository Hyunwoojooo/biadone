import { createHash } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";

import { z } from "zod";

import {
  SCREEN_EVIDENCE_BUNDLE_FILES_V1,
  SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
  SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
  SCREEN_EVIDENCE_LIMITS_V1,
  SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
  SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
  SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
  type QualifiedScreenEvidenceBundleV1,
  type ScreenEvidenceBundleEntryV1,
  type ScreenEvidenceBundleFileV1,
  type ScreenEvidenceBundleInputV1,
  type ScreenEvidenceManifestV1,
  type ScreenEvidencePayloadV1,
} from "./contractsV1";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const uint8ArraySet = Uint8Array.prototype.set;
const typedArrayPrototype = objectGetPrototypeOf(Uint8Array.prototype);
const typedArrayBufferGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)!.get!;
const typedArrayByteLengthGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)!.get!;
const typedArrayByteOffsetGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)!.get!;
const arrayBufferResizableGetter = objectGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const textEncoder = new TextEncoder();

export const SCREEN_EVIDENCE_QUALIFICATION_SCHEMA_VERSION_V1 =
  "blabase.screen-evidence-qualification.v1" as const;
export const SCREEN_EVIDENCE_REPLAY_HASH_DOMAIN_V1 =
  "blabase.screen-evidence-replay.v1" as const;

const MAXIMUM_SAFE_WIRE_INTEGER = Number.MAX_SAFE_INTEGER;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

const safeUnsignedInteger = z
  .number()
  .int()
  .min(0)
  .max(MAXIMUM_SAFE_WIRE_INTEGER);
const positiveSafeInteger = safeUnsignedInteger.min(1);
const confidence = z.number().finite().min(0).max(1);
const identifier = z.string().regex(idPattern);
const sha256Hex = z.string().regex(sha256Pattern);
const boundedString = (maximumBytes: number) =>
  z
    .string()
    .min(1)
    .refine((value) => textEncoder.encode(value).byteLength <= maximumBytes);

const captureSchema = z
  .object({
    captureId: identifier,
    revision: positiveSafeInteger,
    capturedAtEpochMs: safeUnsignedInteger,
  })
  .strict();

const observationBase = {
  observationId: identifier,
  captureId: identifier,
  capturedAtEpochMs: safeUnsignedInteger,
  confidence,
};
const observationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...observationBase,
      kind: z.literal("ocr_span"),
      text: boundedString(SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes),
    })
    .strict(),
  z
    .object({
      ...observationBase,
      kind: z.enum(["application", "screen", "activity"]),
      label: boundedString(512),
    })
    .strict(),
]);

const conflictSchema = z.discriminatedUnion("code", [
  z
    .object({
      code: z.literal("CAPTURE_REVISION_CONFLICT"),
      captureId: identifier,
    })
    .strict(),
  z
    .object({
      code: z.literal("OBSERVATION_CAPTURE_CONFLICT"),
      observationId: identifier,
      captureId: identifier,
    })
    .strict(),
  z
    .object({
      code: z.literal("PREPROCESSING_PROVENANCE_CONFLICT"),
      captureId: identifier,
    })
    .strict(),
]);

const issueSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("OCR_UNAVAILABLE"), captureId: identifier }).strict(),
  z.object({ code: z.literal("CAPTURE_PARTIAL"), captureId: identifier }).strict(),
  z
    .object({
      code: z.literal("OBSERVATION_LOW_CONFIDENCE"),
      observationId: identifier,
      captureId: identifier,
    })
    .strict(),
  z
    .object({
      code: z.literal("CAPTURE_GAP"),
      beforeCaptureId: identifier,
      afterCaptureId: identifier,
    })
    .strict(),
]);

const payloadSchema = z
  .object({
    schemaVersion: z.literal(SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1),
    producerIdentity: z.literal(SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1),
    preprocessingVersion: z.literal(SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1),
    exportRunId: identifier,
    window: z
      .object({ startEpochMs: safeUnsignedInteger, endEpochMs: safeUnsignedInteger })
      .strict(),
    provenance: z
      .object({
        sourceSystem: z.literal("blabase.capture-store.v1"),
        sourceRevision: identifier,
        preprocessingVersion: z.literal(
          SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
        ),
        privacyProfile: z.literal(
          "blabase.privacy-minimized-screen-evidence.v1",
        ),
      })
      .strict(),
    captures: z
      .array(captureSchema)
      .min(1)
      .max(SCREEN_EVIDENCE_LIMITS_V1.captures),
    observations: z
      .array(observationSchema)
      .max(SCREEN_EVIDENCE_LIMITS_V1.observations),
    coverage: z
      .object({
        captureCount: safeUnsignedInteger,
        observationCount: safeUnsignedInteger,
        ocrSpanCount: safeUnsignedInteger,
        coveredCaptureCount: safeUnsignedInteger,
        coveredCaptureRatio: confidence,
      })
      .strict(),
    conflicts: z
      .array(conflictSchema)
      .max(SCREEN_EVIDENCE_LIMITS_V1.conflicts),
    issues: z.array(issueSchema).max(SCREEN_EVIDENCE_LIMITS_V1.issues),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1),
    canonicalizationProfile: z.literal(
      SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
    ),
    producerIdentity: z.literal(SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1),
    preprocessingVersion: z.literal(SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1),
    exportRunId: identifier,
    payloadFile: z.literal("payload.json"),
    payloadByteCount: positiveSafeInteger.max(
      SCREEN_EVIDENCE_LIMITS_V1.payloadBytes,
    ),
    payloadSha256: sha256Hex,
  })
  .strict();

export type ScreenEvidenceQualificationIssueCodeV1 =
  | "BUNDLE_INPUT_INVALID"
  | "BUNDLE_INCOMPLETE"
  | "ENTRY_SET_MISMATCH"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "MARKER_INVALID"
  | "JSON_INVALID"
  | "JSON_DUPLICATE_KEY"
  | "MANIFEST_INVALID"
  | "PAYLOAD_INVALID"
  | "HASH_BINDING_MISMATCH"
  | "FORBIDDEN_FIELD"
  | "FORBIDDEN_TOKEN"
  | "ORDER_INVALID"
  | "REFERENCE_INVALID"
  | "COVERAGE_INVALID";

export class ScreenEvidenceQualificationErrorV1 extends Error {
  readonly issueCode: ScreenEvidenceQualificationIssueCodeV1;

  constructor(issueCode: ScreenEvidenceQualificationIssueCodeV1) {
    super(`Screen evidence qualification failed (${issueCode})`);
    this.name = "ScreenEvidenceQualificationErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: ScreenEvidenceQualificationIssueCodeV1): never {
  throw new ScreenEvidenceQualificationErrorV1(issueCode);
}

function maximumBytesForEntry(relativePath: ScreenEvidenceBundleFileV1): number {
  switch (relativePath) {
    case "payload.json":
      return SCREEN_EVIDENCE_LIMITS_V1.payloadBytes;
    case "manifest.json":
      return SCREEN_EVIDENCE_LIMITS_V1.manifestBytes;
    case "manifest.sha256":
    case "COMPLETE":
      return SCREEN_EVIDENCE_LIMITS_V1.markerBytes;
  }
}

function snapshotExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    arrayIsArray(value) ||
    nodeUtilTypes.isProxy(value) ||
    objectGetPrototypeOf(value) !== Object.prototype
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  let descriptors: ReturnType<typeof objectGetOwnPropertyDescriptors>;
  try {
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const keys = reflectOwnKeys(descriptors);
  const expected = new Set(expectedKeys);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotArray(value: unknown): readonly unknown[] {
  if (
    !arrayIsArray(value) ||
    nodeUtilTypes.isProxy(value) ||
    objectGetPrototypeOf(value) !== Array.prototype
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const lengthDescriptor = (
    descriptors as unknown as Record<string, PropertyDescriptor | undefined>
  )["length"];
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > SCREEN_EVIDENCE_BUNDLE_FILES_V1.length
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const allowed = new Set<string>(["length"]);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    allowed.add(String(index));
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.length !== lengthDescriptor.value + 1 ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const snapshot = new Array<unknown>(lengthDescriptor.value);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function copyOwnedBytes(value: unknown, expectedByteLength: number): Uint8Array {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      nodeUtilTypes.isProxy(value) ||
      !nodeUtilTypes.isUint8Array(value) ||
      objectGetPrototypeOf(value) !== Uint8Array.prototype
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const buffer = typedArrayBufferGetter.call(value) as ArrayBuffer;
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    const byteOffset = typedArrayByteOffsetGetter.call(value) as number;
    if (
      !nodeUtilTypes.isArrayBuffer(buffer) ||
      nodeUtilTypes.isSharedArrayBuffer(buffer) ||
      objectGetPrototypeOf(buffer) !== ArrayBuffer.prototype ||
      (arrayBufferResizableGetter?.call(buffer) as boolean | undefined) === true ||
      byteOffset !== 0 ||
      buffer.byteLength !== byteLength ||
      byteLength !== expectedByteLength
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const copy = new Uint8Array(byteLength);
    Reflect.apply(uint8ArraySet, copy, [value]);
    return copy;
  } catch (error) {
    if (error instanceof ScreenEvidenceQualificationErrorV1) throw error;
    return fail("BUNDLE_INPUT_INVALID");
  }
}

function snapshotInput(candidate: unknown): Readonly<{
  bundleDirectoryName: string;
  entriesByPath: ReadonlyMap<ScreenEvidenceBundleFileV1, ScreenEvidenceBundleEntryV1>;
}> {
  const input = snapshotExactRecord(candidate, ["bundleDirectoryName", "entries"]);
  if (
    typeof input.bundleDirectoryName !== "string" ||
    !idPattern.test(input.bundleDirectoryName)
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const candidates = snapshotArray(input.entries);
  const required = new Set<string>(SCREEN_EVIDENCE_BUNDLE_FILES_V1);
  const entries = new Map<ScreenEvidenceBundleFileV1, ScreenEvidenceBundleEntryV1>();
  for (const candidateEntry of candidates) {
    const entry = snapshotExactRecord(candidateEntry, [
      "relativePath",
      "entryKind",
      "byteLength",
      "bytes",
    ]);
    if (typeof entry.relativePath === "string" && !required.has(entry.relativePath)) {
      return fail("ENTRY_SET_MISMATCH");
    }
    if (
      typeof entry.relativePath !== "string" ||
      !required.has(entry.relativePath) ||
      entry.entryKind !== "regular-file" ||
      typeof entry.byteLength !== "number" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const relativePath = entry.relativePath as ScreenEvidenceBundleFileV1;
    if (entry.byteLength > maximumBytesForEntry(relativePath)) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    if (entries.has(relativePath)) return fail("ENTRY_SET_MISMATCH");
    entries.set(
      relativePath,
      objectFreeze({
        relativePath,
        entryKind: "regular-file" as const,
        byteLength: entry.byteLength,
        bytes: copyOwnedBytes(entry.bytes, entry.byteLength),
      }),
    );
  }
  if (entries.size !== SCREEN_EVIDENCE_BUNDLE_FILES_V1.length) {
    if (SCREEN_EVIDENCE_BUNDLE_FILES_V1.some((name) => !entries.has(name))) {
      return fail("BUNDLE_INCOMPLETE");
    }
    return fail("ENTRY_SET_MISMATCH");
  }
  return { bundleDirectoryName: input.bundleDirectoryName, entriesByPath: entries };
}

class JsonWireParseError extends Error {
  constructor(readonly kind: "invalid" | "duplicate" | "resource") {
    super(kind);
  }
}

class BoundedDuplicateAwareJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new JsonWireParseError("invalid");
    return value;
  }

  private parseValue(depth: number): unknown {
    const token = this.source[this.index];
    if (token === "{") return this.parseObject(depth + 1);
    if (token === "[") return this.parseArray(depth + 1);
    if (token === '"') return this.parseString();
    if (token === "t") return this.parseLiteral("true", true);
    if (token === "f") return this.parseLiteral("false", false);
    if (token === "n") return this.parseLiteral("null", null);
    return this.parseNumber();
  }

  private requireDepth(depth: number): void {
    if (depth > SCREEN_EVIDENCE_LIMITS_V1.maximumDepth) {
      throw new JsonWireParseError("resource");
    }
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.requireDepth(depth);
    this.index += 1;
    this.skipWhitespace();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    let propertyCount = 0;
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (this.source[this.index] !== '"') throw new JsonWireParseError("invalid");
      const key = this.parseString();
      if (keys.has(key)) throw new JsonWireParseError("duplicate");
      keys.add(key);
      propertyCount += 1;
      if (propertyCount > SCREEN_EVIDENCE_LIMITS_V1.maximumObjectProperties) {
        throw new JsonWireParseError("resource");
      }
      this.skipWhitespace();
      if (this.source[this.index] !== ":") throw new JsonWireParseError("invalid");
      this.index += 1;
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        value: this.parseValue(depth),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") throw new JsonWireParseError("invalid");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.requireDepth(depth);
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (result.length >= SCREEN_EVIDENCE_LIMITS_V1.maximumArrayElements) {
        throw new JsonWireParseError("resource");
      }
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") throw new JsonWireParseError("invalid");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    this.index += 1;
    let result = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      this.index += 1;
      if (character === '"') {
        if (
          textEncoder.encode(result).byteLength >
          SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes
        ) {
          throw new JsonWireParseError("resource");
        }
        return result;
      }
      if (character === "\\") {
        const escape = this.source[this.index];
        this.index += 1;
        if (escape === '"' || escape === "\\" || escape === "/") result += escape;
        else if (escape === "b") result += "\b";
        else if (escape === "f") result += "\f";
        else if (escape === "n") result += "\n";
        else if (escape === "r") result += "\r";
        else if (escape === "t") result += "\t";
        else if (escape === "u") {
          const digits = this.source.slice(this.index, this.index + 4);
          if (!/^[a-fA-F0-9]{4}$/u.test(digits)) throw new JsonWireParseError("invalid");
          result += String.fromCharCode(Number.parseInt(digits, 16));
          this.index += 4;
        } else {
          throw new JsonWireParseError("invalid");
        }
      } else {
        if (character.charCodeAt(0) < 0x20) throw new JsonWireParseError("invalid");
        result += character;
      }
    }
    throw new JsonWireParseError("invalid");
  }

  private parseLiteral<T>(wire: string, value: T): T {
    if (this.source.slice(this.index, this.index + wire.length) !== wire) {
      throw new JsonWireParseError("invalid");
    }
    this.index += wire.length;
    return value;
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.index),
    );
    if (match === null) throw new JsonWireParseError("invalid");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new JsonWireParseError("invalid");
    return value;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.source[this.index] ?? "")) {
      const character = this.source[this.index]!;
      if (character !== " " && character !== "\n" && character !== "\r" && character !== "\t") {
        throw new JsonWireParseError("invalid");
      }
      this.index += 1;
    }
  }
}

function parseJsonBytes(bytes: Uint8Array, maximumBytes: number): unknown {
  if (bytes.byteLength === 0) return fail("JSON_INVALID");
  if (bytes.byteLength > maximumBytes) return fail("RESOURCE_LIMIT_EXCEEDED");
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return fail("JSON_INVALID");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("JSON_INVALID");
  }
  try {
    return new BoundedDuplicateAwareJsonParser(text).parse();
  } catch (error) {
    if (error instanceof JsonWireParseError) {
      if (error.kind === "duplicate") return fail("JSON_DUPLICATE_KEY");
      if (error.kind === "resource") return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    return fail("JSON_INVALID");
  }
}

const forbiddenKeys = new Set([
  "apikey",
  "authorization",
  "caveat",
  "credential",
  "credentials",
  "filepath",
  "fileurl",
  "items",
  "metadata",
  "outputitempath",
  "password",
  "path",
  "ranking",
  "rawscreenshot",
  "recentfocus",
  "screenshotbytes",
  "screenshotpath",
  "semanticoutput",
  "suggestionsummary",
  "suggestiontitle",
  "summary",
  "title",
  "token",
  "visibletaskintent",
]);
const forbiddenTokens = new Set([
  "recentfocus",
  "visibletaskintent",
  "semanticoutput",
  "suggestiontitle",
  "suggestionsummary",
]);

function normalizedToken(value: string): string {
  return value.replace(/[-_\s]/gu, "").toLowerCase();
}

function rejectForbiddenRecursive(value: unknown): void {
  if (arrayIsArray(value)) {
    for (const child of value) rejectForbiddenRecursive(child);
    return;
  }
  if (typeof value === "string") {
    if (
      forbiddenTokens.has(normalizedToken(value)) ||
      /^\/items(?:\/[^/]+)*\/title$/u.test(value)
    ) {
      return fail("FORBIDDEN_TOKEN");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(normalizedToken(key))) return fail("FORBIDDEN_FIELD");
    rejectForbiddenRecursive(child);
  }
}

function assertUnicodeScalars(value: unknown, issueCode: "MANIFEST_INVALID" | "PAYLOAD_INVALID"): void {
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return fail(issueCode);
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return fail(issueCode);
      }
    }
    return;
  }
  if (arrayIsArray(value)) {
    for (const child of value) assertUnicodeScalars(child, issueCode);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertUnicodeScalars(key, issueCode);
      assertUnicodeScalars(child, issueCode);
    }
  }
}

function canonicalize(value: unknown): unknown {
  if (arrayIsArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) result[key] = canonicalize(record[key]);
  return result;
}

function requireCanonicalBytes(
  original: Uint8Array,
  value: unknown,
  issueCode: "MANIFEST_INVALID" | "PAYLOAD_INVALID",
): void {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) return fail(issueCode);
  const canonical = textEncoder.encode(serialized);
  if (canonical.byteLength !== original.byteLength) return fail(issueCode);
  for (let index = 0; index < canonical.byteLength; index += 1) {
    if (canonical[index] !== original[index]) return fail(issueCode);
  }
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactMarker(bytes: Uint8Array): string {
  if (bytes.byteLength !== SCREEN_EVIDENCE_LIMITS_V1.markerBytes) {
    return fail("MARKER_INVALID");
  }
  let value = "";
  for (const byte of bytes) {
    if (!((byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102))) {
      return fail("MARKER_INVALID");
    }
    value += String.fromCharCode(byte);
  }
  return value;
}

function compareTuple(left: readonly [number, string], right: readonly [number, string]): number {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
}

function validatePayload(payload: ScreenEvidencePayloadV1): void {
  if (payload.window.endEpochMs < payload.window.startEpochMs) {
    return fail("COVERAGE_INVALID");
  }
  const captureById = new Map<string, ScreenEvidencePayloadV1["captures"][number]>();
  for (let index = 0; index < payload.captures.length; index += 1) {
    const capture = payload.captures[index]!;
    if (
      capture.capturedAtEpochMs < payload.window.startEpochMs ||
      capture.capturedAtEpochMs > payload.window.endEpochMs
    ) {
      return fail("REFERENCE_INVALID");
    }
    if (captureById.has(capture.captureId)) return fail("REFERENCE_INVALID");
    if (index > 0) {
      const previous = payload.captures[index - 1]!;
      if (
        compareTuple(
          [previous.capturedAtEpochMs, previous.captureId],
          [capture.capturedAtEpochMs, capture.captureId],
        ) >= 0
      ) {
        return fail("ORDER_INVALID");
      }
    }
    captureById.set(capture.captureId, capture);
  }

  const observationById = new Map<string, ScreenEvidencePayloadV1["observations"][number]>();
  const coveredCaptures = new Set<string>();
  let ocrSpanCount = 0;
  for (let index = 0; index < payload.observations.length; index += 1) {
    const observation = payload.observations[index]!;
    if (observationById.has(observation.observationId)) return fail("REFERENCE_INVALID");
    const capture = captureById.get(observation.captureId);
    if (
      capture === undefined ||
      observation.capturedAtEpochMs !== capture.capturedAtEpochMs ||
      observation.capturedAtEpochMs < payload.window.startEpochMs ||
      observation.capturedAtEpochMs > payload.window.endEpochMs
    ) {
      return fail("REFERENCE_INVALID");
    }
    if (index > 0) {
      const previous = payload.observations[index - 1]!;
      if (
        compareTuple(
          [previous.capturedAtEpochMs, previous.observationId],
          [observation.capturedAtEpochMs, observation.observationId],
        ) >= 0
      ) {
        return fail("ORDER_INVALID");
      }
    }
    if (observation.kind === "ocr_span") ocrSpanCount += 1;
    coveredCaptures.add(observation.captureId);
    observationById.set(observation.observationId, observation);
  }

  const ratio = coveredCaptures.size / payload.captures.length;
  if (
    payload.coverage.captureCount !== payload.captures.length ||
    payload.coverage.observationCount !== payload.observations.length ||
    payload.coverage.ocrSpanCount !== ocrSpanCount ||
    payload.coverage.coveredCaptureCount !== coveredCaptures.size ||
    payload.coverage.coveredCaptureRatio !== ratio
  ) {
    return fail("COVERAGE_INVALID");
  }

  const captureIndex = new Map(payload.captures.map((capture, index) => [capture.captureId, index]));
  const seenConflict = new Set<string>();
  for (const conflict of payload.conflicts) {
    if (!captureById.has(conflict.captureId)) return fail("REFERENCE_INVALID");
    if ("observationId" in conflict) {
      const observation = observationById.get(conflict.observationId);
      if (observation === undefined || observation.captureId !== conflict.captureId) {
        return fail("REFERENCE_INVALID");
      }
    }
    const identity = JSON.stringify(conflict);
    if (seenConflict.has(identity)) return fail("REFERENCE_INVALID");
    seenConflict.add(identity);
  }

  const seenIssue = new Set<string>();
  for (const issue of payload.issues) {
    if ("captureId" in issue && !captureById.has(issue.captureId)) {
      return fail("REFERENCE_INVALID");
    }
    if ("observationId" in issue) {
      const observation = observationById.get(issue.observationId);
      if (observation === undefined || observation.captureId !== issue.captureId) {
        return fail("REFERENCE_INVALID");
      }
    }
    if (issue.code === "CAPTURE_GAP") {
      const before = captureIndex.get(issue.beforeCaptureId);
      const after = captureIndex.get(issue.afterCaptureId);
      if (before === undefined || after === undefined || before >= after) {
        return fail("REFERENCE_INVALID");
      }
    }
    const identity = JSON.stringify(issue);
    if (seenIssue.has(identity)) return fail("REFERENCE_INVALID");
    seenIssue.add(identity);
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (arrayIsArray(value)) {
    for (const child of value) deepFreeze(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return objectFreeze(value);
}

function domainSeparatedReplayHash(manifestBytes: Uint8Array, payloadBytes: Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(textEncoder.encode(`${SCREEN_EVIDENCE_REPLAY_HASH_DOMAIN_V1}\0`));
  for (const part of [manifestBytes, payloadBytes]) {
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(part.byteLength), false);
    hash.update(length);
    hash.update(part);
  }
  return hash.digest("hex");
}

export function qualifyScreenEvidenceBundleV1Internal(
  candidate: ScreenEvidenceBundleInputV1,
): QualifiedScreenEvidenceBundleV1 {
  try {
    const input = snapshotInput(candidate);
    const payloadEntry = input.entriesByPath.get("payload.json")!;
    const manifestEntry = input.entriesByPath.get("manifest.json")!;
    const manifestMarker = exactMarker(
      input.entriesByPath.get("manifest.sha256")!.bytes,
    );
    const completionMarker = exactMarker(input.entriesByPath.get("COMPLETE")!.bytes);

    const manifestCandidate = parseJsonBytes(
      manifestEntry.bytes,
      SCREEN_EVIDENCE_LIMITS_V1.manifestBytes,
    );
    assertUnicodeScalars(manifestCandidate, "MANIFEST_INVALID");
    rejectForbiddenRecursive(manifestCandidate);
    const manifestResult = manifestSchema.safeParse(manifestCandidate);
    if (!manifestResult.success) return fail("MANIFEST_INVALID");
    const manifest = manifestResult.data as ScreenEvidenceManifestV1;
    requireCanonicalBytes(manifestEntry.bytes, manifest, "MANIFEST_INVALID");

    const manifestSha256 = rawSha256(manifestEntry.bytes);
    if (manifestMarker !== manifestSha256 || completionMarker !== manifestSha256) {
      return fail("MARKER_INVALID");
    }
    const payloadSha256 = rawSha256(payloadEntry.bytes);
    if (
      manifest.payloadByteCount !== payloadEntry.byteLength ||
      manifest.payloadSha256 !== payloadSha256
    ) {
      return fail("HASH_BINDING_MISMATCH");
    }

    const payloadCandidate = parseJsonBytes(
      payloadEntry.bytes,
      SCREEN_EVIDENCE_LIMITS_V1.payloadBytes,
    );
    assertUnicodeScalars(payloadCandidate, "PAYLOAD_INVALID");
    rejectForbiddenRecursive(payloadCandidate);
    const payloadResult = payloadSchema.safeParse(payloadCandidate);
    if (!payloadResult.success) return fail("PAYLOAD_INVALID");
    const payload = payloadResult.data as ScreenEvidencePayloadV1;
    requireCanonicalBytes(payloadEntry.bytes, payload, "PAYLOAD_INVALID");
    if (
      payload.exportRunId !== manifest.exportRunId ||
      input.bundleDirectoryName !== manifest.exportRunId ||
      payload.producerIdentity !== manifest.producerIdentity ||
      payload.preprocessingVersion !== manifest.preprocessingVersion ||
      payload.provenance.preprocessingVersion !== manifest.preprocessingVersion
    ) {
      return fail("HASH_BINDING_MISMATCH");
    }
    validatePayload(payload);

    return deepFreeze({
      descriptor: {
        qualificationSchemaVersion: SCREEN_EVIDENCE_QUALIFICATION_SCHEMA_VERSION_V1,
        exportRunId: payload.exportRunId,
        manifestByteCount: manifestEntry.byteLength,
        manifestSha256,
        payloadByteCount: payloadEntry.byteLength,
        payloadSha256,
        replayIdentitySha256: domainSeparatedReplayHash(
          manifestEntry.bytes,
          payloadEntry.bytes,
        ),
      },
      manifest,
      evidence: payload,
    });
  } catch (error) {
    if (error instanceof ScreenEvidenceQualificationErrorV1) throw error;
    return fail("BUNDLE_INPUT_INVALID");
  }
}
