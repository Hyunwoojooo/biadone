import { types as nodeUtilTypes } from "node:util";

import { identifierSchema } from "../../dayflowEvidence/contracts";
import { DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS } from "../../dayflowEvidence/preprocessedEvidenceV0_1";
import {
  DAYFLOW_E2_IO_LIMITS,
  DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
  importDayflowEvidenceBundle,
  importDayflowEvidenceBundleForResolutionV0_1,
  type ImportDayflowEvidenceBundleInput,
  type ImportedDayflowEvidenceBundle,
  type ImportedDayflowEvidenceForResolutionV0_1,
} from "./importEvidenceBundle";

export const DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_VERSION =
  "dayflow-preprocessed-evidence-verification-snapshot-v0.1" as const;

export const DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS =
  Object.freeze({
    candidateBytes:
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes,
    entryCount: DAYFLOW_E2_IO_LIMITS.objectCount + 2,
    manifestBytes: DAYFLOW_E2_IO_LIMITS.manifestBytes,
    completionMarkerBytes: DAYFLOW_E2_IO_LIMITS.completionMarkerBytes,
    objectCount: DAYFLOW_E2_IO_LIMITS.objectCount,
    objectBytes: DAYFLOW_E2_IO_LIMITS.objectBytes,
    bundleObjectBytes: DAYFLOW_E2_IO_LIMITS.bundleObjectBytes,
    totalEntryBytes:
      DAYFLOW_E2_IO_LIMITS.manifestBytes +
      DAYFLOW_E2_IO_LIMITS.completionMarkerBytes +
      DAYFLOW_E2_IO_LIMITS.bundleObjectBytes,
  } as const);

export type DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1 =
  | "INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "BUNDLE_IMPORT_REJECTED"
  | "IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH"
  | "SNAPSHOT_HANDLE_INVALID";

export class DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1 extends Error {
  readonly issueCode: DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1;

  constructor(
    issueCode: DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1,
  ) {
    super(`Dayflow preprocessed evidence snapshot failed (${issueCode})`);
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1",
      writable: true,
    });
    this.issueCode = issueCode;
  }
}

declare const ownedSnapshotBrand: unique symbol;

export type OwnedPreprocessedEvidenceVerificationSnapshotV0_1 = Readonly<{
  readonly [ownedSnapshotBrand]: true;
}>;

export type CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1 =
  Readonly<{
    candidateBytes: Uint8Array;
    originalBundle: ImportDayflowEvidenceBundleInput;
    expectedImportedBundleDescriptor: ImportedDayflowEvidenceBundle;
  }>;

type ByteViewPlan = Readonly<{
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
}>;

type BundleEntryPlan = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  byteView: ByteViewPlan;
  entryClass: ImporterParityEntryClass;
}>;

type BundleEntryMetadataPlan = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: unknown;
  entryClass: ImporterParityEntryClass;
}>;

type CapturePlan = Readonly<{
  candidateBytes: ByteViewPlan;
  bundleId: string;
  entries: readonly BundleEntryPlan[];
  expectedImportedBundleDescriptor: ImportedDayflowEvidenceBundle;
}>;

type OwnedBundleEntry = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}>;

type OwnedSnapshotState = Readonly<{
  candidateBytes: Uint8Array;
  originalBundle: Readonly<{
    mode: "synthetic-contract-conformance";
    bundleId: string;
    entries: readonly OwnedBundleEntry[];
  }>;
  expectedImportedBundleDescriptor: ImportedDayflowEvidenceBundle;
}>;

const intrinsicIsProxy = nodeUtilTypes.isProxy;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPrototype = Array.prototype;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectConstruct = Reflect.construct;
const intrinsicUint8Array = Uint8Array;
const intrinsicUint8ArraySet = Uint8Array.prototype.set;
const intrinsicDataView = DataView;
const intrinsicTypedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const intrinsicTypedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)!.get!;
const intrinsicTypedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteOffset",
)!.get!;
const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)!.get!;
const intrinsicTypedArrayTagGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  Symbol.toStringTag,
)!.get!;
const intrinsicArrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;
const intrinsicArrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const importerParityForbiddenPathPattern = /[\\\u0000-\u001f\u007f%]/u;
const importerParityObjectPathPattern =
  /^objects\/sha256\/[a-f0-9]{64}\.jpg$/u;
const descriptorKeys = [
  "importSchemaVersion",
  "manifestRawSha256",
  "manifestDetachedSha256",
  "completionSha256",
  "objectCount",
  "totalObjectBytes",
  "replayIdentitySha256",
] as const;
const captureInputKeys = [
  "candidateBytes",
  "originalBundle",
  "expectedImportedBundleDescriptor",
] as const;
const bundleInputKeys = ["mode", "bundleId", "entries"] as const;
const bundleEntryKeys = [
  "relativePath",
  "entryKind",
  "byteLength",
  "bytes",
] as const;
const ownedSnapshotStates = new WeakMap<
  OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
  OwnedSnapshotState
>();

function fail(
  issueCode: DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1,
): never {
  throw new DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1(
    issueCode,
  );
}

function rethrowClosed(
  error: unknown,
  fallback: DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1,
): never {
  if (
    error instanceof
    DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1
  ) {
    throw error;
  }
  return fail(fallback);
}

function hasExpectedKey(
  expectedKeys: readonly string[],
  candidate: string,
): boolean {
  for (const expected of expectedKeys) {
    if (candidate === expected) return true;
  }
  return false;
}

function readExactPlainDataObject(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  try {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      intrinsicIsProxy(candidate) ||
      intrinsicObjectGetPrototypeOf(candidate) !== intrinsicObjectPrototype
    ) {
      return fail("INPUT_INVALID");
    }

    const values = intrinsicObjectCreate(null) as Record<string, unknown>;
    for (const expectedKey of expectedKeys) {
      const descriptor = intrinsicObjectGetOwnPropertyDescriptor(
        candidate,
        expectedKey,
      );
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return fail("INPUT_INVALID");
      }
      values[expectedKey] = descriptor.value;
    }

    let enumerableKeyCount = 0;
    for (const enumerableKey in candidate as Record<string, unknown>) {
      enumerableKeyCount += 1;
      if (
        enumerableKeyCount > expectedKeys.length ||
        !hasExpectedKey(expectedKeys, enumerableKey)
      ) {
        return fail("INPUT_INVALID");
      }
      const descriptor = intrinsicObjectGetOwnPropertyDescriptor(
        candidate,
        enumerableKey,
      );
      if (descriptor === undefined || descriptor.enumerable !== true) {
        return fail("INPUT_INVALID");
      }
    }
    return values;
  } catch (error) {
    return rethrowClosed(error, "INPUT_INVALID");
  }
}

function readDensePlainArray(
  candidate: unknown,
): readonly unknown[] {
  try {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      intrinsicIsProxy(candidate) ||
      !intrinsicArrayIsArray(candidate) ||
      intrinsicObjectGetPrototypeOf(candidate) !== intrinsicArrayPrototype
    ) {
      return fail("INPUT_INVALID");
    }

    const lengthDescriptor = intrinsicObjectGetOwnPropertyDescriptor(
      candidate,
      "length",
    );
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.enumerable !== false ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return fail("INPUT_INVALID");
    }
    const length = lengthDescriptor.value;
    if (
      length >
      DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.entryCount
    ) {
      return fail("INPUT_INVALID");
    }

    const values = new Array<unknown>(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = intrinsicObjectGetOwnPropertyDescriptor(
        candidate,
        String(index),
      );
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return fail("INPUT_INVALID");
      }
      values[index] = descriptor.value;
    }

    let enumerableKeyCount = 0;
    for (const enumerableKey in candidate as unknown[]) {
      enumerableKeyCount += 1;
      if (enumerableKeyCount > length) return fail("INPUT_INVALID");
      let matchesIndex = false;
      for (let index = 0; index < length; index += 1) {
        if (enumerableKey === String(index)) {
          matchesIndex = true;
          break;
        }
      }
      if (!matchesIndex) return fail("INPUT_INVALID");
      const descriptor = intrinsicObjectGetOwnPropertyDescriptor(
        candidate,
        enumerableKey,
      );
      if (descriptor === undefined || descriptor.enumerable !== true) {
        return fail("INPUT_INVALID");
      }
    }
    return values;
  } catch (error) {
    return rethrowClosed(error, "INPUT_INVALID");
  }
}

function preflightUint8Array(candidate: unknown): ByteViewPlan {
  try {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      intrinsicIsProxy(candidate) ||
      intrinsicReflectApply(intrinsicTypedArrayTagGetter, candidate, []) !==
        "Uint8Array"
    ) {
      return fail("INPUT_INVALID");
    }

    const buffer = intrinsicReflectApply(
      intrinsicTypedArrayBufferGetter,
      candidate,
      [],
    ) as unknown;
    const byteOffset = intrinsicReflectApply(
      intrinsicTypedArrayByteOffsetGetter,
      candidate,
      [],
    ) as unknown;
    const byteLength = intrinsicReflectApply(
      intrinsicTypedArrayByteLengthGetter,
      candidate,
      [],
    ) as unknown;
    const backingByteLength = intrinsicReflectApply(
      intrinsicArrayBufferByteLengthGetter,
      buffer,
      [],
    ) as unknown;

    if (
      typeof byteOffset !== "number" ||
      !Number.isSafeInteger(byteOffset) ||
      byteOffset < 0 ||
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      typeof backingByteLength !== "number" ||
      !Number.isSafeInteger(backingByteLength) ||
      backingByteLength < 0
    ) {
      return fail("INPUT_INVALID");
    }

    intrinsicReflectConstruct(intrinsicDataView, [buffer, 0, 0]);
    if (
      intrinsicArrayBufferResizableGetter !== undefined &&
      intrinsicReflectApply(
        intrinsicArrayBufferResizableGetter,
        buffer,
        [],
      ) === true
    ) {
      return fail("INPUT_INVALID");
    }
    if (
      byteOffset > backingByteLength ||
      byteLength > backingByteLength - byteOffset
    ) {
      return fail("INPUT_INVALID");
    }

    return {
      buffer: buffer as ArrayBuffer,
      byteOffset,
      byteLength,
    };
  } catch (error) {
    return rethrowClosed(error, "INPUT_INVALID");
  }
}

function copyExactByteView(plan: ByteViewPlan): Uint8Array {
  try {
    const source = new intrinsicUint8Array(
      plan.buffer,
      plan.byteOffset,
      plan.byteLength,
    );
    const copy = new intrinsicUint8Array(plan.byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [source]);
    return copy;
  } catch (error) {
    return rethrowClosed(error, "INPUT_INVALID");
  }
}

function copyOwnedBytes(bytes: Uint8Array): Uint8Array {
  try {
    const byteLength = intrinsicReflectApply(
      intrinsicTypedArrayByteLengthGetter,
      bytes,
      [],
    ) as number;
    const copy = new intrinsicUint8Array(byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, copy, [bytes]);
    return copy;
  } catch (error) {
    return rethrowClosed(error, "RESOURCE_LIMIT_EXCEEDED");
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

function copyExpectedImportedBundleDescriptor(
  candidate: unknown,
): ImportedDayflowEvidenceBundle {
  const values = readExactPlainDataObject(candidate, descriptorKeys);
  const importSchemaVersion = values.importSchemaVersion;
  const manifestRawSha256 = values.manifestRawSha256;
  const manifestDetachedSha256 = values.manifestDetachedSha256;
  const completionSha256 = values.completionSha256;
  const objectCount = values.objectCount;
  const totalObjectBytes = values.totalObjectBytes;
  const replayIdentitySha256 = values.replayIdentitySha256;
  if (
    importSchemaVersion !== DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION ||
    !isSha256(manifestRawSha256) ||
    !isSha256(manifestDetachedSha256) ||
    !isSha256(completionSha256) ||
    typeof objectCount !== "number" ||
    !Number.isSafeInteger(objectCount) ||
    objectCount < 0 ||
    objectCount > DAYFLOW_E2_IO_LIMITS.objectCount ||
    typeof totalObjectBytes !== "number" ||
    !Number.isSafeInteger(totalObjectBytes) ||
    totalObjectBytes < 0 ||
    totalObjectBytes > DAYFLOW_E2_IO_LIMITS.bundleObjectBytes ||
    !isSha256(replayIdentitySha256)
  ) {
    return fail("INPUT_INVALID");
  }
  return intrinsicObjectFreeze({
    importSchemaVersion,
    manifestRawSha256,
    manifestDetachedSha256,
    completionSha256,
    objectCount,
    totalObjectBytes,
    replayIdentitySha256,
  });
}

type ImporterParityEntryClass = "manifest" | "completion" | "object";

function classifyImporterParityRelativePath(
  relativePath: string,
): ImporterParityEntryClass | undefined {
  if (
    relativePath.length === 0 ||
    relativePath.length > DAYFLOW_E2_IO_LIMITS.relativePathCharacters ||
    relativePath.startsWith("/") ||
    relativePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    importerParityForbiddenPathPattern.test(relativePath)
  ) {
    return undefined;
  }
  if (relativePath === "manifest.json") return "manifest";
  if (relativePath === "COMPLETE") return "completion";
  if (importerParityObjectPathPattern.test(relativePath)) return "object";
  return undefined;
}

function preflightCaptureInput(candidate: unknown): CapturePlan {
  const root = readExactPlainDataObject(candidate, captureInputKeys);
  const bundle = readExactPlainDataObject(
    root.originalBundle,
    bundleInputKeys,
  );
  if (
    bundle.mode !== "synthetic-contract-conformance" ||
    typeof bundle.bundleId !== "string" ||
    !identifierSchema.safeParse(bundle.bundleId).success
  ) {
    return fail("INPUT_INVALID");
  }
  const entryCandidates = readDensePlainArray(bundle.entries);
  const metadataEntries: BundleEntryMetadataPlan[] = [];
  const seenPaths = new Set<string>();
  let manifestCount = 0;
  let completionCount = 0;
  let objectCount = 0;

  for (const entryCandidate of entryCandidates) {
    const entry = readExactPlainDataObject(
      entryCandidate,
      bundleEntryKeys,
    );
    if (
      typeof entry.relativePath !== "string" ||
      entry.entryKind !== "regular-file" ||
      typeof entry.byteLength !== "number" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0
    ) {
      return fail("INPUT_INVALID");
    }
    const entryClass = classifyImporterParityRelativePath(
      entry.relativePath,
    );
    if (
      entryClass === undefined ||
      seenPaths.has(entry.relativePath)
    ) {
      return fail("INPUT_INVALID");
    }
    seenPaths.add(entry.relativePath);
    if (entryClass === "manifest") {
      manifestCount += 1;
    } else if (entryClass === "completion") {
      completionCount += 1;
    } else {
      objectCount += 1;
    }
    metadataEntries.push({
      relativePath: entry.relativePath,
      entryKind: "regular-file",
      byteLength: entry.byteLength,
      bytes: entry.bytes,
      entryClass,
    });
  }
  if (
    manifestCount !== 1 ||
    completionCount !== 1 ||
    metadataEntries.length !== objectCount + 2
  ) {
    return fail("INPUT_INVALID");
  }
  if (objectCount > DAYFLOW_E2_IO_LIMITS.objectCount) {
    return fail("INPUT_INVALID");
  }
  const expectedImportedBundleDescriptor =
    copyExpectedImportedBundleDescriptor(
      root.expectedImportedBundleDescriptor,
    );

  const candidateBytes = preflightUint8Array(root.candidateBytes);
  const entries: BundleEntryPlan[] = [];
  for (const entry of metadataEntries) {
    const byteView = preflightUint8Array(entry.bytes);
    if (entry.byteLength !== byteView.byteLength) {
      return fail("INPUT_INVALID");
    }
    entries.push({
      relativePath: entry.relativePath,
      entryKind: entry.entryKind,
      byteLength: entry.byteLength,
      byteView,
      entryClass: entry.entryClass,
    });
  }

  if (
    candidateBytes.byteLength >
    DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.candidateBytes
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }

  let totalObjectBytes = 0;
  let totalEntryBytes = 0;
  for (const entry of entries) {
    let maximumEntryBytes: number;
    if (entry.entryClass === "manifest") {
      maximumEntryBytes = DAYFLOW_E2_IO_LIMITS.manifestBytes;
    } else if (entry.entryClass === "completion") {
      maximumEntryBytes = DAYFLOW_E2_IO_LIMITS.completionMarkerBytes;
    } else {
      maximumEntryBytes = DAYFLOW_E2_IO_LIMITS.objectBytes;
      totalObjectBytes += entry.byteView.byteLength;
      if (
        !Number.isSafeInteger(totalObjectBytes) ||
        totalObjectBytes > DAYFLOW_E2_IO_LIMITS.bundleObjectBytes
      ) {
        return fail("RESOURCE_LIMIT_EXCEEDED");
      }
    }
    if (entry.byteView.byteLength > maximumEntryBytes) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    totalEntryBytes += entry.byteView.byteLength;
    if (
      !Number.isSafeInteger(totalEntryBytes) ||
      totalEntryBytes >
        DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.totalEntryBytes
    ) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
  }

  return {
    candidateBytes,
    bundleId: bundle.bundleId,
    entries,
    expectedImportedBundleDescriptor,
  };
}

function buildOwnedState(plan: CapturePlan): OwnedSnapshotState {
  const candidateBytes = copyExactByteView(plan.candidateBytes);
  const entries: OwnedBundleEntry[] = [];
  for (const entry of plan.entries) {
    entries.push(
      intrinsicObjectFreeze({
        relativePath: entry.relativePath,
        entryKind: entry.entryKind,
        byteLength: entry.byteLength,
        bytes: copyExactByteView(entry.byteView),
      }),
    );
  }
  const frozenEntries = intrinsicObjectFreeze(entries);
  const originalBundle = intrinsicObjectFreeze({
    mode: "synthetic-contract-conformance" as const,
    bundleId: plan.bundleId,
    entries: frozenEntries,
  });
  return intrinsicObjectFreeze({
    candidateBytes,
    originalBundle,
    expectedImportedBundleDescriptor:
      plan.expectedImportedBundleDescriptor,
  });
}

function freshBundleCopy(
  state: OwnedSnapshotState,
): ImportDayflowEvidenceBundleInput {
  const entries: Array<ImportDayflowEvidenceBundleInput["entries"][number]> =
    [];
  for (const entry of state.originalBundle.entries) {
    entries.push(
      intrinsicObjectFreeze({
        relativePath: entry.relativePath,
        entryKind: entry.entryKind,
        byteLength: entry.byteLength,
        bytes: copyOwnedBytes(entry.bytes),
      }),
    );
  }
  return intrinsicObjectFreeze({
    mode: state.originalBundle.mode,
    bundleId: state.originalBundle.bundleId,
    entries: intrinsicObjectFreeze(entries),
  });
}

function descriptorsEqual(
  left: ImportedDayflowEvidenceBundle,
  right: ImportedDayflowEvidenceBundle,
): boolean {
  return (
    left.importSchemaVersion === right.importSchemaVersion &&
    left.manifestRawSha256 === right.manifestRawSha256 &&
    left.manifestDetachedSha256 === right.manifestDetachedSha256 &&
    left.completionSha256 === right.completionSha256 &&
    left.objectCount === right.objectCount &&
    left.totalObjectBytes === right.totalObjectBytes &&
    left.replayIdentitySha256 === right.replayIdentitySha256
  );
}

function copyTrustedDescriptor(
  descriptor: ImportedDayflowEvidenceBundle,
): ImportedDayflowEvidenceBundle {
  return intrinsicObjectFreeze({
    importSchemaVersion: descriptor.importSchemaVersion,
    manifestRawSha256: descriptor.manifestRawSha256,
    manifestDetachedSha256: descriptor.manifestDetachedSha256,
    completionSha256: descriptor.completionSha256,
    objectCount: descriptor.objectCount,
    totalObjectBytes: descriptor.totalObjectBytes,
    replayIdentitySha256: descriptor.replayIdentitySha256,
  });
}

function verifyOwnedState(
  state: OwnedSnapshotState,
): ImportedDayflowEvidenceBundle {
  let imported: ImportedDayflowEvidenceBundle;
  try {
    imported = importDayflowEvidenceBundle(freshBundleCopy(state));
  } catch {
    return fail("BUNDLE_IMPORT_REJECTED");
  }
  if (
    !descriptorsEqual(
      imported,
      state.expectedImportedBundleDescriptor,
    )
  ) {
    return fail("IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH");
  }
  return copyTrustedDescriptor(imported);
}

function requireOwnedState(
  snapshot: OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
): OwnedSnapshotState {
  try {
    const state = ownedSnapshotStates.get(snapshot);
    if (state === undefined) return fail("SNAPSHOT_HANDLE_INVALID");
    return state;
  } catch (error) {
    return rethrowClosed(error, "SNAPSHOT_HANDLE_INVALID");
  }
}

/** @internal */
export function captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1(
  input: CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1,
): OwnedPreprocessedEvidenceVerificationSnapshotV0_1 {
  try {
    const plan = preflightCaptureInput(input);
    const state = buildOwnedState(plan);
    const handle = intrinsicObjectFreeze(
      intrinsicObjectCreate(null),
    ) as OwnedPreprocessedEvidenceVerificationSnapshotV0_1;
    ownedSnapshotStates.set(handle, state);
    return handle;
  } catch (error) {
    return rethrowClosed(error, "INPUT_INVALID");
  }
}

export function captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
  input: CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1,
): OwnedPreprocessedEvidenceVerificationSnapshotV0_1 {
  try {
    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1(input);
    reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(snapshot);
    return snapshot;
  } catch (error) {
    return rethrowClosed(error, "INPUT_INVALID");
  }
}

export function copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
  snapshot: OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
): Uint8Array {
  return copyOwnedBytes(requireOwnedState(snapshot).candidateBytes);
}

export function copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
  snapshot: OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
): ImportDayflowEvidenceBundleInput {
  return freshBundleCopy(requireOwnedState(snapshot));
}

export function reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
  snapshot: OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
): ImportedDayflowEvidenceBundle {
  return verifyOwnedState(requireOwnedState(snapshot));
}

/** @internal */
export function reverifyOwnedPreprocessedEvidenceVerificationSnapshotForResolutionV0_1(
  snapshot: OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
): ImportedDayflowEvidenceForResolutionV0_1 {
  const state = requireOwnedState(snapshot);
  let imported: ImportedDayflowEvidenceForResolutionV0_1;
  try {
    imported = importDayflowEvidenceBundleForResolutionV0_1(
      freshBundleCopy(state),
    );
  } catch {
    throw new DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1(
      "BUNDLE_IMPORT_REJECTED",
    );
  }

  const actual = imported.descriptor;
  const expected = state.expectedImportedBundleDescriptor;
  if (
    actual.importSchemaVersion !== expected.importSchemaVersion ||
    actual.manifestRawSha256 !== expected.manifestRawSha256 ||
    actual.manifestDetachedSha256 !== expected.manifestDetachedSha256 ||
    actual.completionSha256 !== expected.completionSha256 ||
    actual.objectCount !== expected.objectCount ||
    actual.totalObjectBytes !== expected.totalObjectBytes ||
    actual.replayIdentitySha256 !== expected.replayIdentitySha256
  ) {
    throw new DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1(
      "IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH",
    );
  }
  return imported;
}
