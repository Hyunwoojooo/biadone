import { types as nodeUtilTypes } from "node:util";

import {
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_REPLAY_HASH_DOMAIN,
  DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1,
  DayflowMetadataEvidenceQualificationErrorV1,
  qualifyDayflowMetadataEvidenceBundleV1Internal,
  type DayflowMetadataEvidenceBundleEntryV1,
  type DayflowMetadataEvidenceManifestV1,
  type DayflowMetadataEvidencePayloadV1,
  type DayflowMetadataEvidenceQualificationIssueCodeV1,
  type QualifyDayflowMetadataEvidenceBundleV1Input,
} from "./dayflowMetadataEvidenceBundleQualificationV1.internal";

export {
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_REPLAY_HASH_DOMAIN,
  DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1,
};
export type {
  DayflowMetadataEvidenceBundleEntryV1,
  DayflowMetadataEvidenceManifestV1,
  DayflowMetadataEvidencePayloadV1,
};

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const objectKeys = Object.keys;
const arrayIsArray = Array.isArray;

export const DAYFLOW_METADATA_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION =
  "dayflow.blabase-evidence-bundle-import.v1" as const;

export interface ImportDayflowMetadataEvidenceBundleV1Input {
  readonly mode: "synthetic-task1-handoff";
  readonly bundleDirectoryName: string;
  readonly entries: readonly DayflowMetadataEvidenceBundleEntryV1[];
}

export interface ImportedDayflowMetadataEvidenceDescriptorV1 {
  readonly importSchemaVersion: typeof DAYFLOW_METADATA_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION;
  readonly exportRunId: string;
  readonly manifestByteCount: number;
  readonly manifestSha256: string;
  readonly payloadByteCount: number;
  readonly payloadSha256: string;
  readonly replayIdentitySha256: string;
}

export interface ImportedDayflowMetadataEvidenceBundleV1 {
  readonly descriptor: ImportedDayflowMetadataEvidenceDescriptorV1;
  readonly manifest: DayflowMetadataEvidenceManifestV1;
  readonly evidence: DayflowMetadataEvidencePayloadV1;
}

export type DayflowMetadataEvidenceImportIssueCodeV1 =
  DayflowMetadataEvidenceQualificationIssueCodeV1;

export class DayflowMetadataEvidenceImportErrorV1 extends Error {
  readonly issueCode: DayflowMetadataEvidenceImportIssueCodeV1;

  constructor(issueCode: DayflowMetadataEvidenceImportIssueCodeV1) {
    super(`Dayflow metadata evidence import failed (${issueCode})`);
    this.name = "DayflowMetadataEvidenceImportErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: DayflowMetadataEvidenceImportIssueCodeV1): never {
  throw new DayflowMetadataEvidenceImportErrorV1(issueCode);
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    arrayIsArray(value) ||
    nodeUtilTypes.isProxy(value)
  ) {
    return false;
  }
  try {
    const prototype = objectGetPrototypeOf(value);
    return prototype === objectPrototype || prototype === null;
  } catch {
    return false;
  }
}

function snapshotInput(
  candidate: unknown,
): QualifyDayflowMetadataEvidenceBundleV1Input {
  if (!isSafeRecord(candidate)) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  let descriptors: ReturnType<typeof objectGetOwnPropertyDescriptors>;
  try {
    descriptors = objectGetOwnPropertyDescriptors(candidate);
  } catch {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const keys = objectKeys(descriptors);
  const expected = ["bundleDirectoryName", "entries", "mode"];
  if (
    keys.length !== expected.length ||
    !expected.every((key) => keys.includes(key))
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const mode = descriptors.mode;
  const name = descriptors.bundleDirectoryName;
  const entries = descriptors.entries;
  if (
    mode === undefined ||
    !("value" in mode) ||
    mode.value !== "synthetic-task1-handoff" ||
    name === undefined ||
    !("value" in name) ||
    entries === undefined ||
    !("value" in entries)
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  return {
    bundleDirectoryName: name.value,
    entries: entries.value,
  } as QualifyDayflowMetadataEvidenceBundleV1Input;
}

export function importDayflowMetadataEvidenceBundleV1(
  input: ImportDayflowMetadataEvidenceBundleV1Input,
): ImportedDayflowMetadataEvidenceBundleV1 {
  try {
    const qualified = qualifyDayflowMetadataEvidenceBundleV1Internal(
      snapshotInput(input),
    );
    const descriptor = objectFreeze({
      importSchemaVersion:
        DAYFLOW_METADATA_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
      exportRunId: qualified.descriptor.exportRunId,
      manifestByteCount: qualified.descriptor.manifestByteCount,
      manifestSha256: qualified.descriptor.manifestSha256,
      payloadByteCount: qualified.descriptor.payloadByteCount,
      payloadSha256: qualified.descriptor.payloadSha256,
      replayIdentitySha256: qualified.descriptor.replayIdentitySha256,
    });
    return objectFreeze({
      descriptor,
      manifest: qualified.manifest,
      evidence: qualified.evidence,
    });
  } catch (error) {
    if (error instanceof DayflowMetadataEvidenceImportErrorV1) {
      throw error;
    }
    if (error instanceof DayflowMetadataEvidenceQualificationErrorV1) {
      return fail(error.issueCode);
    }
    return fail("BUNDLE_INPUT_INVALID");
  }
}
