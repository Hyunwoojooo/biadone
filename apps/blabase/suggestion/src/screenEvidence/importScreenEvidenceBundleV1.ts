import { types as nodeUtilTypes } from "node:util";

import {
  type QualifiedScreenEvidenceBundleV1,
  type ScreenEvidenceBundleEntryV1,
  type ScreenEvidenceBundleInputV1,
  type ScreenEvidenceBundleFileV1,
  SCREEN_EVIDENCE_BUNDLE_FILES_V1,
} from "./contractsV1";
import {
  qualifyScreenEvidenceBundleV1Internal,
  ScreenEvidenceQualificationErrorV1,
  type ScreenEvidenceQualificationIssueCodeV1,
} from "./qualifyScreenEvidenceBundleV1.internal";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const uint8ArraySet = Uint8Array.prototype.set;
const typedArrayPrototype = objectGetPrototypeOf(Uint8Array.prototype);
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)!.get!;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)!.get!;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)!.get!;

export const SCREEN_EVIDENCE_IMPORT_SCHEMA_VERSION_V1 =
  "blabase.screen-evidence-import.v1" as const;

export type ScreenEvidenceImportIssueCodeV1 = ScreenEvidenceQualificationIssueCodeV1;

export class ScreenEvidenceImportErrorV1 extends Error {
  readonly issueCode: ScreenEvidenceImportIssueCodeV1;

  constructor(issueCode: ScreenEvidenceImportIssueCodeV1) {
    super(`Screen evidence import failed (${issueCode})`);
    this.name = "ScreenEvidenceImportErrorV1";
    this.issueCode = issueCode;
  }
}

export interface ImportedScreenEvidenceBundleV1
  extends Omit<QualifiedScreenEvidenceBundleV1, "descriptor"> {
  readonly descriptor: QualifiedScreenEvidenceBundleV1["descriptor"] &
    Readonly<{
      importSchemaVersion: typeof SCREEN_EVIDENCE_IMPORT_SCHEMA_VERSION_V1;
    }>;
}

function fail(issueCode: ScreenEvidenceImportIssueCodeV1): never {
  throw new ScreenEvidenceImportErrorV1(issueCode);
}

function dataDescriptorValue(
  descriptors: ReturnType<typeof objectGetOwnPropertyDescriptors>,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  if (descriptor === undefined || !("value" in descriptor)) return fail("BUNDLE_INPUT_INVALID");
  return descriptor.value;
}

function copyUint8Array(value: unknown, declaredLength: number): Uint8Array {
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
      byteOffset !== 0 ||
      buffer.byteLength !== byteLength ||
      byteLength !== declaredLength
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const copy = new Uint8Array(byteLength);
    Reflect.apply(uint8ArraySet, copy, [value]);
    return copy;
  } catch (error) {
    if (error instanceof ScreenEvidenceImportErrorV1) throw error;
    return fail("BUNDLE_INPUT_INVALID");
  }
}

function snapshotInput(candidate: unknown): ScreenEvidenceBundleInputV1 {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    arrayIsArray(candidate) ||
    nodeUtilTypes.isProxy(candidate) ||
    objectGetPrototypeOf(candidate) !== Object.prototype
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const inputDescriptors = objectGetOwnPropertyDescriptors(candidate);
  const inputKeys = reflectOwnKeys(inputDescriptors);
  if (
    inputKeys.length !== 2 ||
    !inputKeys.every((key) => key === "bundleDirectoryName" || key === "entries")
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const bundleDirectoryName = dataDescriptorValue(inputDescriptors, "bundleDirectoryName");
  const entriesCandidate = dataDescriptorValue(inputDescriptors, "entries");
  if (
    typeof bundleDirectoryName !== "string" ||
    !arrayIsArray(entriesCandidate) ||
    nodeUtilTypes.isProxy(entriesCandidate) ||
    objectGetPrototypeOf(entriesCandidate) !== Array.prototype
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const arrayDescriptors = objectGetOwnPropertyDescriptors(entriesCandidate);
  const length = dataDescriptorValue(arrayDescriptors, "length");
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > SCREEN_EVIDENCE_BUNDLE_FILES_V1.length
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const expectedArrayKeys = new Set<string>(["length"]);
  for (let index = 0; index < length; index += 1) expectedArrayKeys.add(String(index));
  if (
    reflectOwnKeys(arrayDescriptors).some(
      (key) => typeof key !== "string" || !expectedArrayKeys.has(key),
    )
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }

  const entries: ScreenEvidenceBundleEntryV1[] = [];
  for (let index = 0; index < length; index += 1) {
    const entryCandidate = dataDescriptorValue(arrayDescriptors, String(index));
    if (
      entryCandidate === null ||
      typeof entryCandidate !== "object" ||
      arrayIsArray(entryCandidate) ||
      nodeUtilTypes.isProxy(entryCandidate) ||
      objectGetPrototypeOf(entryCandidate) !== Object.prototype
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const descriptors = objectGetOwnPropertyDescriptors(entryCandidate);
    const allowed = new Set(["relativePath", "entryKind", "byteLength", "bytes"]);
    const keys = reflectOwnKeys(descriptors);
    if (keys.length !== 4 || keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const relativePath = dataDescriptorValue(descriptors, "relativePath");
    const entryKind = dataDescriptorValue(descriptors, "entryKind");
    const byteLength = dataDescriptorValue(descriptors, "byteLength");
    const bytes = dataDescriptorValue(descriptors, "bytes");
    if (
      typeof relativePath !== "string" ||
      !SCREEN_EVIDENCE_BUNDLE_FILES_V1.includes(relativePath as ScreenEvidenceBundleFileV1) ||
      entryKind !== "regular-file" ||
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    entries.push(
      objectFreeze({
        relativePath: relativePath as ScreenEvidenceBundleFileV1,
        entryKind: "regular-file" as const,
        byteLength,
        bytes: copyUint8Array(bytes, byteLength),
      }),
    );
  }
  return objectFreeze({ bundleDirectoryName, entries: objectFreeze(entries) });
}

export function importScreenEvidenceBundleV1(
  input: ScreenEvidenceBundleInputV1,
): ImportedScreenEvidenceBundleV1 {
  try {
    const qualified = qualifyScreenEvidenceBundleV1Internal(snapshotInput(input));
    return objectFreeze({
      descriptor: objectFreeze({
        ...qualified.descriptor,
        importSchemaVersion: SCREEN_EVIDENCE_IMPORT_SCHEMA_VERSION_V1,
      }),
      manifest: qualified.manifest,
      evidence: qualified.evidence,
    });
  } catch (error) {
    if (error instanceof ScreenEvidenceImportErrorV1) throw error;
    if (error instanceof ScreenEvidenceQualificationErrorV1) {
      return fail(error.issueCode);
    }
    return fail("BUNDLE_INPUT_INVALID");
  }
}
