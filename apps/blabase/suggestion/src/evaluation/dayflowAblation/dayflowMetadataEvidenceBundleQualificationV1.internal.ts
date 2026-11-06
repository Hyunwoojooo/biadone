import { createHash } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";

import { z } from "zod";

import { domainSeparatedSha256 } from "../../dayflowEvidence/contracts";
import {
  parseStrictDuplicateAwareJson,
  StrictDuplicateAwareJsonParseError,
} from "./strictDuplicateAwareJson";

const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetOwnPropertyDescriptors =
  Object.getOwnPropertyDescriptors;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicUint8ArraySet = Uint8Array.prototype.set;
const intrinsicTypedArrayPrototype = intrinsicObjectGetPrototypeOf(
  Uint8Array.prototype,
);
const intrinsicTypedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)!.get!;
const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)!.get!;
const encoder = new TextEncoder();

export const DAYFLOW_METADATA_EVIDENCE_BUNDLE_QUALIFICATION_SCHEMA_VERSION =
  "dayflow.blabase-evidence-bundle-qualification.v1" as const;
export const DAYFLOW_METADATA_EVIDENCE_BUNDLE_REPLAY_HASH_DOMAIN =
  "blabase.dayflow-metadata-evidence-bundle-replay.v1" as const;

export const DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1 = intrinsicObjectFreeze({
  manifestBytes: 16 * 1024,
  payloadBytes: 5 * 1024 * 1024,
  screenshots: 10_000,
  batches: 10_000,
  batchScreenshotLinks: 20_000,
  observationMetadata: 10_000,
  gaps: 10_001,
  missingFields: 20_000,
  issues: 6,
} as const);

const MAXIMUM_WIRE_INTEGER_V1 = 9_007_199_254_740_991;
const CAPTURE_GAP_THRESHOLD_SECONDS_V1 = 30;

const safeUnsignedIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(MAXIMUM_WIRE_INTEGER_V1);
const positiveSafeIntegerSchema = safeUnsignedIntegerSchema.min(1);
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const exportRunIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

const screenshotSchema = z
  .object({
    screenshotId: positiveSafeIntegerSchema,
    capturedAtEpochSecond: safeUnsignedIntegerSchema,
    fileSizeBytes: safeUnsignedIntegerSchema.optional(),
    idleSecondsAtCapture: safeUnsignedIntegerSchema.optional(),
  })
  .strict();

const batchSchema = z
  .object({
    batchId: safeUnsignedIntegerSchema,
    startEpochSecond: safeUnsignedIntegerSchema,
    endEpochSecond: safeUnsignedIntegerSchema,
    status: z.enum([
      "pending",
      "processing",
      "completed",
      "failed",
      "cancelled",
      "unknown",
    ]),
  })
  .strict();

const batchScreenshotLinkSchema = z
  .object({
    batchId: safeUnsignedIntegerSchema,
    screenshotId: positiveSafeIntegerSchema,
  })
  .strict();

const observationMetadataSchema = z
  .object({
    observationId: safeUnsignedIntegerSchema,
    batchId: safeUnsignedIntegerSchema,
    startEpochSecond: safeUnsignedIntegerSchema,
    endEpochSecond: safeUnsignedIntegerSchema,
    producerModelSha256: sha256HexSchema.optional(),
  })
  .strict();

const gapSchema = z
  .object({
    kind: z.enum(["leading", "between-captures", "trailing"]),
    fromBoundaryEpochSecond: safeUnsignedIntegerSchema,
    toBoundaryEpochSecond: safeUnsignedIntegerSchema,
    elapsedSeconds: positiveSafeIntegerSchema,
    expectedMaximumSeconds: positiveSafeIntegerSchema,
  })
  .strict();

const missingFieldSchema = z
  .object({
    recordKind: z.enum(["screenshot", "observation-metadata"]),
    recordId: safeUnsignedIntegerSchema,
    fields: z
      .array(
        z.enum([
          "fileSizeBytes",
          "idleSecondsAtCapture",
          "producerModelSha256",
        ]),
      )
      .min(1)
      .max(2),
  })
  .strict();

const issueCodeSchema = z.enum([
  "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
  "NO_SCREENSHOT_METADATA_IN_WINDOW",
  "OPTIONAL_SOURCE_METADATA_MISSING",
  "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
  "CAPTURE_GAP_DETECTED",
  "DATABASE_SCHEMA_USER_VERSION_UNSET",
]);

const issueSchema = z
  .object({
    code: issueCodeSchema,
    severity: z.literal("warning"),
    affectedRecordCount: safeUnsignedIntegerSchema,
  })
  .strict();

const payloadSchema = z
  .object({
    schemaVersion: z.literal("dayflow.blabase-evidence-bundle.v1"),
    exporterVersion: z.literal("dayflow.blabase-evidence-exporter.v2"),
    exportRunId: exportRunIdSchema,
    window: z
      .object({
        startEpochSecond: safeUnsignedIntegerSchema,
        endEpochSecond: safeUnsignedIntegerSchema,
      })
      .strict(),
    provenance: z
      .object({
        sourceSystem: z.literal("dayflow.sqlite"),
        sourceDatabaseSchemaUserVersion: safeUnsignedIntegerSchema,
        snapshotSemantics: z.literal("grdb.database-pool.read-snapshot"),
        preprocessingVersion: z.literal(
          "dayflow.metadata-only.preprocessing.v1",
        ),
        privacyProfile: z.literal("metadata-only.v1"),
        observationTextPolicy: z.literal("excluded-unverified"),
      })
      .strict(),
    screenshots: z
      .array(screenshotSchema)
      .min(1)
      .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.screenshots),
    batches: z
      .array(batchSchema)
      .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.batches),
    batchScreenshotLinks: z
      .array(batchScreenshotLinkSchema)
      .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.batchScreenshotLinks),
    observationMetadata: z
      .array(observationMetadataSchema)
      .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.observationMetadata),
    coverage: z
      .object({
        requestedWindowSeconds: positiveSafeIntegerSchema,
        screenshotCount: safeUnsignedIntegerSchema,
        linkedBatchCount: safeUnsignedIntegerSchema,
        observationMetadataCount: safeUnsignedIntegerSchema,
        firstCapturedAtEpochSecond: safeUnsignedIntegerSchema.optional(),
        lastCapturedAtEpochSecond: safeUnsignedIntegerSchema.optional(),
        observedSpanSeconds: positiveSafeIntegerSchema.optional(),
        captureGapThresholdSeconds: z.literal(
          CAPTURE_GAP_THRESHOLD_SECONDS_V1,
        ),
        gaps: z
          .array(gapSchema)
          .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.gaps),
      })
      .strict(),
    missingFields: z
      .array(missingFieldSchema)
      .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.missingFields),
    issues: z
      .array(issueSchema)
      .max(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.issues),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal("dayflow.blabase-evidence-manifest.v1"),
    canonicalizationProfile: z.literal(
      "foundation.sorted-keys.no-whitespace.integer-domain.v1",
    ),
    exportRunId: exportRunIdSchema,
    exporterVersion: z.literal("dayflow.blabase-evidence-exporter.v2"),
    payloadFile: z.literal("payload.json"),
    payloadByteCount: positiveSafeIntegerSchema.max(
      DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.payloadBytes,
    ),
    payloadSha256: sha256HexSchema,
  })
  .strict();

export type DayflowMetadataEvidencePayloadV1 = z.infer<typeof payloadSchema>;
export type DayflowMetadataEvidenceManifestV1 = z.infer<typeof manifestSchema>;

export type DayflowMetadataEvidenceBundleEntryV1 = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}>;

export type QualifyDayflowMetadataEvidenceBundleV1Input = Readonly<{
  bundleDirectoryName: string;
  entries: readonly DayflowMetadataEvidenceBundleEntryV1[];
}>;

export type QualifiedDayflowMetadataEvidenceDescriptorV1 = Readonly<{
  qualificationSchemaVersion:
    typeof DAYFLOW_METADATA_EVIDENCE_BUNDLE_QUALIFICATION_SCHEMA_VERSION;
  exportRunId: string;
  manifestByteCount: number;
  manifestSha256: string;
  payloadByteCount: number;
  payloadSha256: string;
  replayIdentitySha256: string;
}>;

export type QualifiedDayflowMetadataEvidenceBundleV1 = Readonly<{
  descriptor: QualifiedDayflowMetadataEvidenceDescriptorV1;
  manifest: DayflowMetadataEvidenceManifestV1;
  evidence: DayflowMetadataEvidencePayloadV1;
}>;

export type DayflowMetadataEvidenceQualificationIssueCodeV1 =
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
  | "ORDER_INVALID"
  | "REFERENCE_INVALID"
  | "COVERAGE_INVALID";

export class DayflowMetadataEvidenceQualificationErrorV1 extends Error {
  readonly issueCode: DayflowMetadataEvidenceQualificationIssueCodeV1;

  constructor(issueCode: DayflowMetadataEvidenceQualificationIssueCodeV1) {
    super("Dayflow metadata evidence qualification failed (" + issueCode + ")");
    this.name = "DayflowMetadataEvidenceQualificationErrorV1";
    this.issueCode = issueCode;
  }
}

type ValidatedEntry = Readonly<{
  relativePath: string;
  byteLength: number;
  bytes: Uint8Array;
}>;

const requiredEntryPaths = intrinsicObjectFreeze([
  "payload.json",
  "manifest.json",
  "manifest.sha256",
  "COMPLETE",
] as const);
const requiredEntryPathSet = new Set<string>(requiredEntryPaths);

function fail(issueCode: DayflowMetadataEvidenceQualificationIssueCodeV1): never {
  throw new DayflowMetadataEvidenceQualificationErrorV1(issueCode);
}

function snapshotExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
  issueCode: DayflowMetadataEvidenceQualificationIssueCodeV1,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    intrinsicArrayIsArray(value) ||
    nodeUtilTypes.isProxy(value) ||
    intrinsicObjectGetPrototypeOf(value) !== Object.prototype
  ) {
    return fail(issueCode);
  }
  const descriptors = intrinsicObjectGetOwnPropertyDescriptors(value);
  const actualKeys = intrinsicReflectOwnKeys(descriptors);
  const expectedKeySet = new Set(expectedKeys);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key) => typeof key !== "string" || !expectedKeySet.has(key),
    )
  ) {
    fail(issueCode);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(issueCode);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotInputEntries(value: unknown): readonly unknown[] {
  if (
    !intrinsicArrayIsArray(value) ||
    nodeUtilTypes.isProxy(value) ||
    intrinsicObjectGetPrototypeOf(value) !== Array.prototype
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }
  const descriptors = intrinsicObjectGetOwnPropertyDescriptors(value);
  const lengthDescriptor: unknown = descriptors.length;
  if (
    lengthDescriptor === null ||
    typeof lengthDescriptor !== "object" ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }
  const length = lengthDescriptor.value;
  if (length > requiredEntryPaths.length) fail("ENTRY_SET_MISMATCH");
  const allowedKeys = new Set<string>(["length"]);
  for (let index = 0; index < length; index += 1) {
    allowedKeys.add(String(index));
  }
  const actualKeys = intrinsicReflectOwnKeys(descriptors);
  if (
    actualKeys.length !== length + 1 ||
    actualKeys.some(
      (key) => typeof key !== "string" || !allowedKeys.has(key),
    )
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }
  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) {
      fail("BUNDLE_INPUT_INVALID");
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function copyExactOwnedUint8Array(
  value: unknown,
  expectedByteLength: number,
): Uint8Array {
  if (
    value === null ||
    typeof value !== "object" ||
    nodeUtilTypes.isProxy(value) ||
    !nodeUtilTypes.isUint8Array(value) ||
    intrinsicObjectGetPrototypeOf(value) !== Uint8Array.prototype
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }
  const bytes = value as Uint8Array;
  const buffer = intrinsicTypedArrayBufferGetter.call(bytes) as unknown;
  const byteLength = intrinsicTypedArrayByteLengthGetter.call(bytes) as number;
  if (
    !nodeUtilTypes.isArrayBuffer(buffer) ||
    nodeUtilTypes.isSharedArrayBuffer(buffer) ||
    intrinsicObjectGetPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    byteLength !== expectedByteLength
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }
  const ownedBytes = new Uint8Array(byteLength);
  intrinsicUint8ArraySet.call(ownedBytes, bytes);
  return ownedBytes;
}

function maximumBytesForEntry(relativePath: string): number {
  if (relativePath === "payload.json") {
    return DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.payloadBytes;
  }
  if (relativePath === "manifest.json") {
    return DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.manifestBytes;
  }
  return 64;
}

function validateInput(
  candidate: unknown,
): Readonly<{
  bundleDirectoryName: string;
  entriesByPath: ReadonlyMap<string, ValidatedEntry>;
}> {
  const input = snapshotExactPlainRecord(
    candidate,
    ["bundleDirectoryName", "entries"],
    "BUNDLE_INPUT_INVALID",
  );
  const bundleDirectoryName = input.bundleDirectoryName;
  if (
    typeof bundleDirectoryName !== "string" ||
    !exportRunIdSchema.safeParse(bundleDirectoryName).success
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }
  const entries = snapshotInputEntries(input.entries);

  const entriesByPath = new Map<string, ValidatedEntry>();
  for (const entryCandidate of entries) {
    const entry = snapshotExactPlainRecord(
      entryCandidate,
      ["byteLength", "bytes", "entryKind", "relativePath"],
      "BUNDLE_INPUT_INVALID",
    );
    const relativePath = entry.relativePath;
    if (
      typeof relativePath === "string" &&
      !requiredEntryPathSet.has(relativePath)
    ) {
      fail("ENTRY_SET_MISMATCH");
    }
    if (
      typeof relativePath !== "string" ||
      entry.entryKind !== "regular-file" ||
      typeof entry.byteLength !== "number" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength > MAXIMUM_WIRE_INTEGER_V1 ||
      entry.byteLength < 0 ||
      !requiredEntryPathSet.has(relativePath)
    ) {
      fail("BUNDLE_INPUT_INVALID");
    }
    if (entry.byteLength > maximumBytesForEntry(relativePath)) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    const ownedBytes = copyExactOwnedUint8Array(
      entry.bytes,
      entry.byteLength,
    );
    if (entriesByPath.has(relativePath)) fail("ENTRY_SET_MISMATCH");
    entriesByPath.set(relativePath, {
      relativePath,
      byteLength: entry.byteLength,
      bytes: ownedBytes,
    });
  }

  if (entriesByPath.size !== requiredEntryPaths.length) {
    if (requiredEntryPaths.some((path) => !entriesByPath.has(path))) {
      fail("BUNDLE_INCOMPLETE");
    }
    fail("ENTRY_SET_MISMATCH");
  }

  return {
    bundleDirectoryName,
    entriesByPath,
  };
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactAsciiSha256(
  bytes: Uint8Array,
  issueCode: DayflowMetadataEvidenceQualificationIssueCodeV1,
): string {
  if (bytes.byteLength !== 64) return fail(issueCode);
  let value = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!;
    if (
      !(
        (byte >= 48 && byte <= 57) ||
        (byte >= 97 && byte <= 102)
      )
    ) {
      return fail(issueCode);
    }
    value += String.fromCharCode(byte);
  }
  return value;
}

function parseJsonBytes(
  bytes: Uint8Array,
  maximumBytes: number,
): unknown {
  if (bytes.byteLength === 0) fail("JSON_INVALID");
  if (bytes.byteLength > maximumBytes) fail("RESOURCE_LIMIT_EXCEEDED");
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    fail("JSON_INVALID");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("JSON_INVALID");
  }

  try {
    return parseStrictDuplicateAwareJson(text);
  } catch (error) {
    if (
      error instanceof StrictDuplicateAwareJsonParseError &&
      error.issueCode === "DUPLICATE_JSON_KEY"
    ) {
      return fail("JSON_DUPLICATE_KEY");
    }
    return fail("JSON_INVALID");
  }
}

const forbiddenNormalizedKeys = new Set([
  "applicationhint",
  "batchreason",
  "caveat",
  "detailedtranscription",
  "filepath",
  "fileurl",
  "headers",
  "llmheaders",
  "llmmetadata",
  "llmrequest",
  "llmresponse",
  "llmurl",
  "metadata",
  "observation",
  "observationblob",
  "observationtext",
  "path",
  "ranking",
  "requestbody",
  "responsebody",
  "screenshotbytes",
  "semanticoutput",
  "suggestionsummary",
  "suggestiontitle",
  "summary",
  "taskintent",
  "timelinecards",
  "title",
  "url",
]);

function rejectForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectForbiddenFields(entry);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[-_\s]/gu, "").toLowerCase();
    if (forbiddenNormalizedKeys.has(normalized)) fail("FORBIDDEN_FIELD");
    rejectForbiddenFields(child);
  }
}

function strictlyIncreasing(
  values: readonly (readonly number[])[],
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    let comparison = 0;
    for (let part = 0; part < previous.length; part += 1) {
      if (current[part]! > previous[part]!) {
        comparison = 1;
        break;
      }
      if (current[part]! < previous[part]!) {
        comparison = -1;
        break;
      }
    }
    if (comparison !== 1) return false;
  }
  return true;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recursivelySortedJsonValue(value: unknown): unknown {
  if (intrinsicArrayIsArray(value)) {
    const result = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      result[index] = recursivelySortedJsonValue(value[index]);
    }
    return result;
  }
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    result[key] = recursivelySortedJsonValue(record[key]);
  }
  return result;
}

function requireCanonicalJsonBytes(
  originalBytes: Uint8Array,
  validatedValue: unknown,
  issueCode: "MANIFEST_INVALID" | "PAYLOAD_INVALID",
): void {
  const serialized = JSON.stringify(
    recursivelySortedJsonValue(validatedValue),
  );
  if (serialized === undefined) fail(issueCode);
  const canonicalBytes = encoder.encode(serialized);
  if (canonicalBytes.byteLength !== originalBytes.byteLength) {
    fail(issueCode);
  }
  for (let index = 0; index < canonicalBytes.byteLength; index += 1) {
    if (canonicalBytes[index] !== originalBytes[index]) fail(issueCode);
  }
}

function validatePayloadInvariants(
  payload: DayflowMetadataEvidencePayloadV1,
): void {
  const { startEpochSecond, endEpochSecond } = payload.window;
  if (endEpochSecond < startEpochSecond) fail("COVERAGE_INVALID");
  const requestedWindowSeconds =
    endEpochSecond - startEpochSecond + 1;
  if (
    !Number.isSafeInteger(requestedWindowSeconds) ||
    requestedWindowSeconds !== payload.coverage.requestedWindowSeconds
  ) {
    fail("COVERAGE_INVALID");
  }

  if (
    !strictlyIncreasing(
      payload.screenshots.map((item) => [
        item.capturedAtEpochSecond,
        item.screenshotId,
      ]),
    ) ||
    !strictlyIncreasing(
      payload.batches.map((item) => [
        item.startEpochSecond,
        item.batchId,
      ]),
    ) ||
    !strictlyIncreasing(
      payload.batchScreenshotLinks.map((item) => [
        item.batchId,
        item.screenshotId,
      ]),
    ) ||
    !strictlyIncreasing(
      payload.observationMetadata.map((item) => [
        item.startEpochSecond,
        item.observationId,
      ]),
    )
  ) {
    fail("ORDER_INVALID");
  }

  const screenshotIds = new Set<number>();
  for (const screenshot of payload.screenshots) {
    if (
      screenshotIds.has(screenshot.screenshotId) ||
      screenshot.capturedAtEpochSecond < startEpochSecond ||
      screenshot.capturedAtEpochSecond > endEpochSecond
    ) {
      fail("REFERENCE_INVALID");
    }
    screenshotIds.add(screenshot.screenshotId);
  }

  const batchIds = new Set<number>();
  for (const batch of payload.batches) {
    if (
      batchIds.has(batch.batchId) ||
      batch.endEpochSecond < batch.startEpochSecond
    ) {
      fail("REFERENCE_INVALID");
    }
    batchIds.add(batch.batchId);
  }

  const observationIds = new Set<number>();
  for (const observation of payload.observationMetadata) {
    if (
      observationIds.has(observation.observationId) ||
      !batchIds.has(observation.batchId) ||
      observation.endEpochSecond < observation.startEpochSecond ||
      observation.endEpochSecond < startEpochSecond ||
      observation.startEpochSecond > endEpochSecond
    ) {
      fail("REFERENCE_INVALID");
    }
    observationIds.add(observation.observationId);
  }

  const linkedScreenshotIds = new Set<number>();
  const linkedBatchIds = new Set<number>();
  for (const link of payload.batchScreenshotLinks) {
    if (
      !screenshotIds.has(link.screenshotId) ||
      !batchIds.has(link.batchId)
    ) {
      fail("REFERENCE_INVALID");
    }
    linkedScreenshotIds.add(link.screenshotId);
    linkedBatchIds.add(link.batchId);
  }
  if ([...batchIds].some((batchId) => !linkedBatchIds.has(batchId))) {
    fail("REFERENCE_INVALID");
  }

  if (
    payload.coverage.screenshotCount !== payload.screenshots.length ||
    payload.coverage.linkedBatchCount !== payload.batches.length ||
    payload.coverage.observationMetadataCount !==
      payload.observationMetadata.length
  ) {
    fail("COVERAGE_INVALID");
  }

  type Gap = DayflowMetadataEvidencePayloadV1["coverage"]["gaps"][number];
  const expectedGaps: Gap[] = [];
  const threshold = payload.coverage.captureGapThresholdSeconds;
  if (payload.screenshots.length === 0) {
    if (
      payload.coverage.firstCapturedAtEpochSecond !== undefined ||
      payload.coverage.lastCapturedAtEpochSecond !== undefined ||
      payload.coverage.observedSpanSeconds !== undefined
    ) {
      fail("COVERAGE_INVALID");
    }
  } else {
    const first = payload.screenshots[0]!;
    const last = payload.screenshots.at(-1)!;
    const observedSpanSeconds =
      last.capturedAtEpochSecond - first.capturedAtEpochSecond + 1;
    if (
      payload.coverage.firstCapturedAtEpochSecond !==
        first.capturedAtEpochSecond ||
      payload.coverage.lastCapturedAtEpochSecond !==
        last.capturedAtEpochSecond ||
      payload.coverage.observedSpanSeconds !== observedSpanSeconds
    ) {
      fail("COVERAGE_INVALID");
    }
    const leadingElapsed =
      first.capturedAtEpochSecond - startEpochSecond;
    if (leadingElapsed > threshold) {
      expectedGaps.push({
        kind: "leading",
        fromBoundaryEpochSecond: startEpochSecond,
        toBoundaryEpochSecond: first.capturedAtEpochSecond,
        elapsedSeconds: leadingElapsed,
        expectedMaximumSeconds: threshold,
      });
    }
    for (let index = 1; index < payload.screenshots.length; index += 1) {
      const previous = payload.screenshots[index - 1]!;
      const current = payload.screenshots[index]!;
      const elapsed =
        current.capturedAtEpochSecond - previous.capturedAtEpochSecond;
      if (elapsed > threshold) {
        expectedGaps.push({
          kind: "between-captures",
          fromBoundaryEpochSecond: previous.capturedAtEpochSecond,
          toBoundaryEpochSecond: current.capturedAtEpochSecond,
          elapsedSeconds: elapsed,
          expectedMaximumSeconds: threshold,
        });
      }
    }
    const trailingElapsed =
      endEpochSecond - last.capturedAtEpochSecond;
    if (trailingElapsed > threshold) {
      expectedGaps.push({
        kind: "trailing",
        fromBoundaryEpochSecond: last.capturedAtEpochSecond,
        toBoundaryEpochSecond: endEpochSecond,
        elapsedSeconds: trailingElapsed,
        expectedMaximumSeconds: threshold,
      });
    }
  }
  if (!jsonEqual(payload.coverage.gaps, expectedGaps)) {
    fail("COVERAGE_INVALID");
  }

  type Missing = DayflowMetadataEvidencePayloadV1["missingFields"][number];
  const expectedMissingFields: Missing[] = [];
  for (const screenshot of payload.screenshots) {
    const fields: Missing["fields"][number][] = [];
    if (screenshot.fileSizeBytes === undefined) fields.push("fileSizeBytes");
    if (screenshot.idleSecondsAtCapture === undefined) {
      fields.push("idleSecondsAtCapture");
    }
    if (fields.length > 0) {
      expectedMissingFields.push({
        recordKind: "screenshot",
        recordId: screenshot.screenshotId,
        fields,
      });
    }
  }
  for (const observation of payload.observationMetadata) {
    if (observation.producerModelSha256 === undefined) {
      expectedMissingFields.push({
        recordKind: "observation-metadata",
        recordId: observation.observationId,
        fields: ["producerModelSha256"],
      });
    }
  }
  if (!jsonEqual(payload.missingFields, expectedMissingFields)) {
    fail("COVERAGE_INVALID");
  }

  type Issue = DayflowMetadataEvidencePayloadV1["issues"][number];
  const expectedIssues: Issue[] = [
    {
      code: "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
      severity: "warning",
      affectedRecordCount: payload.observationMetadata.length,
    },
  ];
  if (payload.screenshots.length === 0) {
    expectedIssues.push({
      code: "NO_SCREENSHOT_METADATA_IN_WINDOW",
      severity: "warning",
      affectedRecordCount: 0,
    });
  }
  if (expectedMissingFields.length > 0) {
    expectedIssues.push({
      code: "OPTIONAL_SOURCE_METADATA_MISSING",
      severity: "warning",
      affectedRecordCount: expectedMissingFields.length,
    });
  }
  const unlinkedScreenshotCount = [...screenshotIds].filter(
    (screenshotId) => !linkedScreenshotIds.has(screenshotId),
  ).length;
  if (unlinkedScreenshotCount > 0) {
    expectedIssues.push({
      code: "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
      severity: "warning",
      affectedRecordCount: unlinkedScreenshotCount,
    });
  }
  if (expectedGaps.length > 0) {
    expectedIssues.push({
      code: "CAPTURE_GAP_DETECTED",
      severity: "warning",
      affectedRecordCount: expectedGaps.length,
    });
  }
  if (payload.provenance.sourceDatabaseSchemaUserVersion === 0) {
    expectedIssues.push({
      code: "DATABASE_SCHEMA_USER_VERSION_UNSET",
      severity: "warning",
      affectedRecordCount: 1,
    });
  }
  if (!jsonEqual(payload.issues, expectedIssues)) {
    fail("COVERAGE_INVALID");
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return intrinsicObjectFreeze(value);
}

function qualifyInternal(
  candidate: unknown,
): QualifiedDayflowMetadataEvidenceBundleV1 {
  const input = validateInput(candidate);
  const manifestEntry = input.entriesByPath.get("manifest.json")!;
  const payloadEntry = input.entriesByPath.get("payload.json")!;
  const detachedEntry = input.entriesByPath.get("manifest.sha256")!;
  const completionEntry = input.entriesByPath.get("COMPLETE")!;

  const detachedManifestSha256 = exactAsciiSha256(
    detachedEntry.bytes,
    "MARKER_INVALID",
  );
  const completionSha256 = exactAsciiSha256(
    completionEntry.bytes,
    "MARKER_INVALID",
  );
  if (completionSha256 !== detachedManifestSha256) fail("MARKER_INVALID");

  const manifestRawSha256 = rawSha256(manifestEntry.bytes);
  if (manifestRawSha256 !== detachedManifestSha256) {
    fail("HASH_BINDING_MISMATCH");
  }

  const manifestCandidate = parseJsonBytes(
    manifestEntry.bytes,
    DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.manifestBytes,
  );
  const manifestResult = manifestSchema.safeParse(manifestCandidate);
  if (!manifestResult.success) fail("MANIFEST_INVALID");
  const manifest = manifestResult.data;
  requireCanonicalJsonBytes(
    manifestEntry.bytes,
    manifest,
    "MANIFEST_INVALID",
  );

  if (
    manifest.exportRunId !== input.bundleDirectoryName ||
    manifest.payloadByteCount !== payloadEntry.byteLength ||
    manifest.payloadSha256 !== rawSha256(payloadEntry.bytes)
  ) {
    fail("HASH_BINDING_MISMATCH");
  }

  const payloadCandidate = parseJsonBytes(
    payloadEntry.bytes,
    DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.payloadBytes,
  );
  rejectForbiddenFields(payloadCandidate);
  const payloadResult = payloadSchema.safeParse(payloadCandidate);
  if (!payloadResult.success) fail("PAYLOAD_INVALID");
  const payload = payloadResult.data;
  requireCanonicalJsonBytes(payloadEntry.bytes, payload, "PAYLOAD_INVALID");

  if (
    payload.exportRunId !== input.bundleDirectoryName ||
    payload.exportRunId !== manifest.exportRunId ||
    payload.exporterVersion !== manifest.exporterVersion
  ) {
    fail("HASH_BINDING_MISMATCH");
  }
  validatePayloadInvariants(payload);

  const descriptor = deepFreeze({
    qualificationSchemaVersion:
      DAYFLOW_METADATA_EVIDENCE_BUNDLE_QUALIFICATION_SCHEMA_VERSION,
    exportRunId: payload.exportRunId,
    manifestByteCount: manifestEntry.byteLength,
    manifestSha256: manifestRawSha256,
    payloadByteCount: payloadEntry.byteLength,
    payloadSha256: manifest.payloadSha256,
    replayIdentitySha256: domainSeparatedSha256(
      DAYFLOW_METADATA_EVIDENCE_BUNDLE_REPLAY_HASH_DOMAIN,
      {
        exportRunId: payload.exportRunId,
        manifestByteCount: manifestEntry.byteLength,
        manifestSha256: manifestRawSha256,
        payloadByteCount: payloadEntry.byteLength,
        payloadSha256: manifest.payloadSha256,
      },
    ),
  });
  return deepFreeze({
    descriptor,
    manifest,
    evidence: payload,
  });
}

export function qualifyDayflowMetadataEvidenceBundleV1Internal(
  input: QualifyDayflowMetadataEvidenceBundleV1Input,
): QualifiedDayflowMetadataEvidenceBundleV1 {
  try {
    return qualifyInternal(input);
  } catch (error) {
    if (error instanceof DayflowMetadataEvidenceQualificationErrorV1) throw error;
    return fail("BUNDLE_INPUT_INVALID");
  }
}
