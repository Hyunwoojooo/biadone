import { createHash } from "node:crypto";

import { z } from "zod";

import {
  domainSeparatedSha256,
  identifierSchema,
  jcsCanonicalize,
  sha256HexSchema,
  utcTimestampSchema,
  verifyArtifactBlobBytes,
  verifyRegisteredArtifactHash,
  dayflowScreenEvidenceExportSchema,
  type DayflowScreenEvidenceExport,
} from "../../dayflowEvidence/contracts";
import {
  parseStrictDuplicateAwareJson,
  StrictDuplicateAwareJsonParseError,
} from "./strictDuplicateAwareJson";

const intrinsicObjectFreeze = Object.freeze;

export const DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_SCHEMA_VERSION =
  "dayflow-screen-evidence-bundle-completion-v0.1" as const;
export const DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_HASH_DOMAIN =
  "blabase.dayflow-screen-evidence-bundle-completion.v0.1" as const;
export const DAYFLOW_E2_IO_REPLAY_HASH_DOMAIN =
  "blabase.dayflow-screen-evidence-bundle-replay.v0.1" as const;
export const DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION =
  "dayflow-screen-evidence-bundle-import-v0.1" as const;

export const DAYFLOW_E2_IO_LIMITS = Object.freeze({
  manifestBytes: 1024 * 1024,
  completionMarkerBytes: 16 * 1024,
  objectCount: 256,
  objectBytes: 10 * 1024 * 1024,
  bundleObjectBytes: 256 * 1024 * 1024,
  relativePathCharacters: 180,
} as const);

const safeCounterSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const completionPreimageSchema = z
  .object({
    completionSchemaVersion: z.literal(
      DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_SCHEMA_VERSION,
    ),
    bundleId: identifierSchema,
    exportId: identifierSchema,
    manifestRelativePath: z.literal("manifest.json"),
    manifestByteLength: safeCounterSchema
      .min(1)
      .max(DAYFLOW_E2_IO_LIMITS.manifestBytes),
    manifestRawSha256: sha256HexSchema,
    manifestDetachedSha256: sha256HexSchema,
    objectCount: safeCounterSchema.max(DAYFLOW_E2_IO_LIMITS.objectCount),
    totalObjectBytes: safeCounterSchema.max(
      DAYFLOW_E2_IO_LIMITS.bundleObjectBytes,
    ),
    completedAt: utcTimestampSchema,
  })
  .strict();

const completionObjectSchema = completionPreimageSchema
  .extend({ completionSha256: sha256HexSchema })
  .strict();

export const dayflowEvidenceBundleCompletionSchema =
  completionObjectSchema.superRefine((value, context) => {
    const { completionSha256: _ignored, ...preimage } = value;
    if (
      value.completionSha256 !==
      domainSeparatedSha256(
        DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_HASH_DOMAIN,
        preimage,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completionSha256"],
        message: "Completion marker hash mismatch",
      });
    }
  });

export type DayflowEvidenceBundleCompletionPreimage = z.infer<
  typeof completionPreimageSchema
>;
export type DayflowEvidenceBundleCompletion = z.infer<
  typeof dayflowEvidenceBundleCompletionSchema
>;

export function dayflowEvidenceBundleCompletionSha256(
  value: DayflowEvidenceBundleCompletionPreimage,
): string {
  return domainSeparatedSha256(
    DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_HASH_DOMAIN,
    completionPreimageSchema.parse(value),
  );
}

export function sealDayflowEvidenceBundleCompletion(
  value: DayflowEvidenceBundleCompletionPreimage,
): DayflowEvidenceBundleCompletion {
  const parsed = completionPreimageSchema.parse(value);
  return dayflowEvidenceBundleCompletionSchema.parse({
    ...parsed,
    completionSha256: dayflowEvidenceBundleCompletionSha256(parsed),
  });
}

export type DayflowEvidenceBundleImportIssueCode =
  | "BUNDLE_INPUT_INVALID"
  | "BUNDLE_INCOMPLETE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "JSON_INVALID"
  | "JSON_DUPLICATE_KEY"
  | "JSON_NOT_CANONICAL"
  | "COMPLETION_MARKER_INVALID"
  | "MANIFEST_INVALID"
  | "MANIFEST_BINDING_MISMATCH"
  | "ENTRY_SET_MISMATCH"
  | "BLOB_BYTES_MISMATCH";

export class DayflowEvidenceBundleImportError extends Error {
  readonly issueCode: DayflowEvidenceBundleImportIssueCode;

  constructor(issueCode: DayflowEvidenceBundleImportIssueCode) {
    super(`Dayflow evidence bundle import failed (${issueCode})`);
    this.name = "DayflowEvidenceBundleImportError";
    this.issueCode = issueCode;
  }
}

export type DayflowEvidenceBundleEntry = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}>;

export type ImportDayflowEvidenceBundleInput = Readonly<{
  mode: "synthetic-contract-conformance";
  bundleId: string;
  entries: readonly DayflowEvidenceBundleEntry[];
}>;

export type ImportedDayflowEvidenceBundle = Readonly<{
  importSchemaVersion: typeof DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION;
  manifestRawSha256: string;
  manifestDetachedSha256: string;
  completionSha256: string;
  objectCount: number;
  totalObjectBytes: number;
  replayIdentitySha256: string;
}>;

export type ImportedDayflowEvidenceResolvedManifestV0_1 = Readonly<{
  manifestRawSha256: string;
  schemaVersion: "dayflow-screen-evidence-export-v0.1";
  exportId: string;
  detachedManifestSha256: string;
  dataOrigin: "synthetic";
  studyPhase: "contract_conformance";
  studyProtocolHash: string;
  windowStart: string;
  windowEnd: string;
  coverage: Readonly<{
    intervals: readonly Readonly<
      DayflowScreenEvidenceExport["coverage"]["intervals"][number]
    >[];
    expectedFrameCount: number;
    observedFrameCount: number;
    rejectedFrameCount: number;
  }>;
  artifacts: readonly Readonly<{
    sourceRowId: string;
    capturedAt: string;
    sha256: string;
  }>[];
}>;

export type ImportedDayflowEvidenceForResolutionV0_1 = Readonly<{
  descriptor: ImportedDayflowEvidenceBundle;
  resolvedManifest: ImportedDayflowEvidenceResolvedManifestV0_1;
}>;

type ValidatedBundleEntry = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}>;

const encoder = new TextEncoder();
const forbiddenPathPattern = /[\\\u0000-\u001f\u007f%]/u;
const objectPathPattern =
  /^objects\/sha256\/([a-f0-9]{64})\.jpg$/u;

function fail(issueCode: DayflowEvidenceBundleImportIssueCode): never {
  throw new DayflowEvidenceBundleImportError(issueCode);
}

function requireRecord(
  value: unknown,
  issueCode: DayflowEvidenceBundleImportIssueCode,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(issueCode);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  issueCode: DayflowEvidenceBundleImportIssueCode,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    actual.length !== canonical.length ||
    actual.some((key, index) => key !== canonical[index])
  ) {
    fail(issueCode);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCanonicalJsonBytes(
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

  let parsed: unknown;
  try {
    parsed = parseStrictDuplicateAwareJson(text);
  } catch (error) {
    if (
      error instanceof StrictDuplicateAwareJsonParseError &&
      error.issueCode === "DUPLICATE_JSON_KEY"
    ) {
      return fail("JSON_DUPLICATE_KEY");
    }
    return fail("JSON_INVALID");
  }

  let canonical: Uint8Array;
  try {
    canonical = encoder.encode(`${jcsCanonicalize(parsed)}\n`);
  } catch {
    return fail("JSON_INVALID");
  }
  if (!bytesEqual(bytes, canonical)) fail("JSON_NOT_CANONICAL");
  return parsed;
}

function maximumForEntry(relativePath: string): number {
  return relativePath === "manifest.json"
    ? DAYFLOW_E2_IO_LIMITS.manifestBytes
    : relativePath === "COMPLETE"
      ? DAYFLOW_E2_IO_LIMITS.completionMarkerBytes
      : DAYFLOW_E2_IO_LIMITS.objectBytes;
}

function validateInputWithoutCopy(
  candidate: unknown,
): Readonly<{
  bundleId: string;
  entries: readonly ValidatedBundleEntry[];
}> {
  const input = requireRecord(candidate, "BUNDLE_INPUT_INVALID");
  requireExactKeys(
    input,
    ["bundleId", "entries", "mode"],
    "BUNDLE_INPUT_INVALID",
  );
  if (
    input.mode !== "synthetic-contract-conformance" ||
    !identifierSchema.safeParse(input.bundleId).success ||
    !Array.isArray(input.entries)
  ) {
    fail("BUNDLE_INPUT_INVALID");
  }

  const seen = new Set<string>();
  const entries: ValidatedBundleEntry[] = [];
  let objectCount = 0;
  let totalObjectBytes = 0;
  for (const entryCandidate of input.entries) {
    const entry = requireRecord(entryCandidate, "BUNDLE_INPUT_INVALID");
    requireExactKeys(
      entry,
      ["byteLength", "bytes", "entryKind", "relativePath"],
      "BUNDLE_INPUT_INVALID",
    );
    if (
      typeof entry.relativePath !== "string" ||
      entry.relativePath.length === 0 ||
      entry.relativePath.length > DAYFLOW_E2_IO_LIMITS.relativePathCharacters ||
      entry.relativePath.startsWith("/") ||
      entry.relativePath.split("/").some((part) => part === "" || part === "." || part === "..") ||
      forbiddenPathPattern.test(entry.relativePath) ||
      entry.entryKind !== "regular-file" ||
      typeof entry.byteLength !== "number" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      !(entry.bytes instanceof Uint8Array) ||
      entry.byteLength !== entry.bytes.byteLength
    ) {
      fail("BUNDLE_INPUT_INVALID");
    }
    const relativePath = entry.relativePath;
    const isManifest = relativePath === "manifest.json";
    const isCompletion = relativePath === "COMPLETE";
    if (
      !isManifest &&
      !isCompletion &&
      !objectPathPattern.test(relativePath)
    ) {
      fail("BUNDLE_INPUT_INVALID");
    }
    if (entry.bytes.byteLength > maximumForEntry(relativePath)) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    if (seen.has(relativePath)) fail("ENTRY_SET_MISMATCH");
    seen.add(relativePath);
    if (!isManifest && !isCompletion) {
      objectCount += 1;
      totalObjectBytes += entry.bytes.byteLength;
      if (
        objectCount > DAYFLOW_E2_IO_LIMITS.objectCount ||
        !Number.isSafeInteger(totalObjectBytes) ||
        totalObjectBytes > DAYFLOW_E2_IO_LIMITS.bundleObjectBytes
      ) {
        fail("RESOURCE_LIMIT_EXCEEDED");
      }
    }
    entries.push({
      relativePath,
      entryKind: "regular-file" as const,
      byteLength: entry.byteLength,
      bytes: entry.bytes,
    });
  }

  return { bundleId: input.bundleId as string, entries };
}

function isJpegFramed(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  );
}

function importDayflowEvidenceBundleInternal(
  candidate: unknown,
): ImportedDayflowEvidenceForResolutionV0_1 {
  const input = validateInputWithoutCopy(candidate);
  const entriesByPath = new Map(
    input.entries.map((entry) => [entry.relativePath, entry] as const),
  );
  const manifestEntry = entriesByPath.get("manifest.json");
  const completionEntry = entriesByPath.get("COMPLETE");
  if (manifestEntry === undefined || completionEntry === undefined) {
    fail("BUNDLE_INCOMPLETE");
  }

  const manifestCandidate = parseCanonicalJsonBytes(
    manifestEntry.bytes,
    DAYFLOW_E2_IO_LIMITS.manifestBytes,
  );
  const manifestResult =
    dayflowScreenEvidenceExportSchema.safeParse(manifestCandidate);
  if (
    !manifestResult.success ||
    manifestResult.data.dataOrigin !== "synthetic" ||
    manifestResult.data.studyPhase !== "contract_conformance" ||
    !verifyRegisteredArtifactHash(
      "dayflow-export-manifest",
      manifestResult.data,
    )
  ) {
    fail("MANIFEST_INVALID");
  }
  const manifest = manifestResult.data;

  const completionCandidate = parseCanonicalJsonBytes(
    completionEntry.bytes,
    DAYFLOW_E2_IO_LIMITS.completionMarkerBytes,
  );
  const completionResult =
    dayflowEvidenceBundleCompletionSchema.safeParse(completionCandidate);
  if (!completionResult.success) fail("COMPLETION_MARKER_INVALID");
  const completion = completionResult.data;
  const manifestRawSha256 = rawSha256(manifestEntry.bytes);

  if (
    completion.bundleId !== input.bundleId ||
    completion.exportId !== manifest.exportId ||
    completion.manifestByteLength !== manifestEntry.bytes.byteLength ||
    completion.manifestRawSha256 !== manifestRawSha256 ||
    completion.manifestDetachedSha256 !==
      manifest.detachedManifestSha256 ||
    completion.objectCount !== manifest.artifacts.length ||
    completion.completedAt < manifest.exportedAt
  ) {
    fail("MANIFEST_BINDING_MISMATCH");
  }

  const artifactsByPath = new Map<
    string,
    DayflowScreenEvidenceExport["artifacts"][number]
  >();
  let totalObjectBytes = 0;
  for (const artifact of manifest.artifacts) {
    const match = objectPathPattern.exec(artifact.relativeBlobRef);
    if (
      artifact.mimeType !== "image/jpeg" ||
      artifact.idleSeconds !== 0 ||
      match?.[1] !== artifact.sha256 ||
      artifactsByPath.has(artifact.relativeBlobRef)
    ) {
      fail("MANIFEST_INVALID");
    }
    const byteSize = Number(artifact.byteSize);
    if (
      !Number.isSafeInteger(byteSize) ||
      byteSize < 0 ||
      byteSize > DAYFLOW_E2_IO_LIMITS.objectBytes
    ) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    totalObjectBytes += byteSize;
    if (
      !Number.isSafeInteger(totalObjectBytes) ||
      totalObjectBytes > DAYFLOW_E2_IO_LIMITS.bundleObjectBytes
    ) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    artifactsByPath.set(artifact.relativeBlobRef, artifact);
  }
  if (completion.totalObjectBytes !== totalObjectBytes) {
    fail("MANIFEST_BINDING_MISMATCH");
  }

  const objectPaths = manifest.artifacts.map(
    (artifact) => artifact.relativeBlobRef,
  );
  const expectedPaths = new Set([
    "manifest.json",
    ...objectPaths,
    "COMPLETE",
  ]);
  if (
    entriesByPath.size !== expectedPaths.size ||
    input.entries.some((entry) => !expectedPaths.has(entry.relativePath))
  ) {
    fail("ENTRY_SET_MISMATCH");
  }

  const replayObjects: Array<
    Readonly<{ relativeBlobRef: string; sha256: string; byteSize: number }>
  > = [];
  for (const relativePath of objectPaths) {
    const artifact = artifactsByPath.get(relativePath)!;
    const entry = entriesByPath.get(relativePath);
    if (
      entry === undefined ||
      entry.byteLength !== Number(artifact.byteSize) ||
      !verifyArtifactBlobBytes(artifact, entry.bytes) ||
      !isJpegFramed(entry.bytes)
    ) {
      fail("BLOB_BYTES_MISMATCH");
    }
    replayObjects.push({
      relativeBlobRef: artifact.relativeBlobRef,
      byteSize: Number(artifact.byteSize),
      sha256: artifact.sha256,
    });
  }

  const replayIdentitySha256 = domainSeparatedSha256(
    DAYFLOW_E2_IO_REPLAY_HASH_DOMAIN,
    {
      bundleId: input.bundleId,
      exportId: manifest.exportId,
      manifestRawSha256,
      manifestDetachedSha256: manifest.detachedManifestSha256,
      completionSha256: completion.completionSha256,
      objects: replayObjects,
    },
  );

  const descriptor = intrinsicObjectFreeze({
    importSchemaVersion: DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
    manifestRawSha256,
    manifestDetachedSha256: manifest.detachedManifestSha256,
    completionSha256: completion.completionSha256,
    objectCount: completion.objectCount,
    totalObjectBytes: completion.totalObjectBytes,
    replayIdentitySha256,
  });
  const coverage = intrinsicObjectFreeze({
    intervals: intrinsicObjectFreeze(
      manifest.coverage.intervals.map((interval) =>
        intrinsicObjectFreeze({
          start: interval.start,
          end: interval.end,
          reason: interval.reason,
          expectedFrameCount: interval.expectedFrameCount,
          observedFrameCount: interval.observedFrameCount,
          rejectedFrameCount: interval.rejectedFrameCount,
        }),
      ),
    ),
    expectedFrameCount: manifest.coverage.expectedFrameCount,
    observedFrameCount: manifest.coverage.observedFrameCount,
    rejectedFrameCount: manifest.coverage.rejectedFrameCount,
  });
  const artifacts = intrinsicObjectFreeze(
    manifest.artifacts.map((artifact) =>
      intrinsicObjectFreeze({
        sourceRowId: artifact.sourceRowId,
        capturedAt: artifact.capturedAt,
        sha256: artifact.sha256,
      }),
    ),
  );
  const resolvedManifest = intrinsicObjectFreeze({
    manifestRawSha256,
    schemaVersion: manifest.schemaVersion,
    exportId: manifest.exportId,
    detachedManifestSha256: manifest.detachedManifestSha256,
    dataOrigin: "synthetic",
    studyPhase: "contract_conformance",
    studyProtocolHash: manifest.studyProtocolHash,
    windowStart: manifest.windowStart,
    windowEnd: manifest.windowEnd,
    coverage,
    artifacts,
  });
  return intrinsicObjectFreeze({ descriptor, resolvedManifest });
}

export function importDayflowEvidenceBundle(
  input: ImportDayflowEvidenceBundleInput,
): ImportedDayflowEvidenceBundle {
  try {
    return importDayflowEvidenceBundleInternal(input).descriptor;
  } catch (error) {
    if (error instanceof DayflowEvidenceBundleImportError) throw error;
    return fail("BUNDLE_INPUT_INVALID");
  }
}

/** @internal */
export function importDayflowEvidenceBundleForResolutionV0_1(
  input: ImportDayflowEvidenceBundleInput,
): ImportedDayflowEvidenceForResolutionV0_1 {
  try {
    return importDayflowEvidenceBundleInternal(input);
  } catch (error) {
    if (error instanceof DayflowEvidenceBundleImportError) throw error;
    return fail("BUNDLE_INPUT_INVALID");
  }
}
