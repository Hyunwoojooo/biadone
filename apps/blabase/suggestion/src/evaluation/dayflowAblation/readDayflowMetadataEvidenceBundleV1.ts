import path from "node:path";
import { types as nodeUtilTypes } from "node:util";

import {
  DayflowMetadataEvidenceFilesystemReadErrorV1,
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1,
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
  readDayflowMetadataEvidenceBundleFilesystemV1Internal,
  type DayflowMetadataEvidenceBundleSourceFileV1,
  type DayflowMetadataEvidenceBundleSourcePathV1,
} from "./dayflowMetadataEvidenceBundleFilesystemReadV1.internal";
import {
  DayflowMetadataEvidenceImportErrorV1,
  importDayflowMetadataEvidenceBundleV1,
  type DayflowMetadataEvidenceBundleEntryV1,
  type ImportedDayflowMetadataEvidenceBundleV1,
} from "./importDayflowMetadataEvidenceBundleV1";

export {
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1,
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
};
export type {
  DayflowMetadataEvidenceBundleSourceFileV1,
  DayflowMetadataEvidenceBundleSourcePathV1,
};

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectKeys = Object.keys;
const objectPrototype = Object.prototype;
const arrayIsArray = Array.isArray;

export const DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_SCHEMA_VERSION =
  "blabase.dayflow-metadata-evidence-bundle-read.v1" as const;

export interface ReadDayflowMetadataEvidenceBundleV1Input {
  readonly mode: "synthetic-task1-handoff";
  readonly outputRoot: string;
  readonly bundleDirectoryName: string;
}

export interface DayflowMetadataEvidenceBundleBridgeDescriptorV1 {
  readonly readSchemaVersion: typeof DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_SCHEMA_VERSION;
  readonly mode: "synthetic-task1-handoff";
  readonly bundleDirectoryName: string;
  readonly sourceOrder: typeof DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1;
}

export interface ReadDayflowMetadataEvidenceBundleV1Result {
  readonly bridgeDescriptor: DayflowMetadataEvidenceBundleBridgeDescriptorV1;
  readonly imported: ImportedDayflowMetadataEvidenceBundleV1;
  readonly sourceFiles: readonly DayflowMetadataEvidenceBundleSourceFileV1[];
  copySourceEntries(): readonly DayflowMetadataEvidenceBundleEntryV1[];
}

export type DayflowMetadataEvidenceBundleReadIssueCodeV1 =
  | "BUNDLE_INPUT_INVALID"
  | "OUTPUT_ROOT_UNSAFE"
  | "BUNDLE_DIRECTORY_UNSAFE"
  | "BUNDLE_INCOMPLETE"
  | "ENTRY_SET_MISMATCH"
  | "FILE_UNSAFE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "FILE_UNSTABLE"
  | "IMPORT_REJECTED"
  | "FILESYSTEM_REJECTED";

export class DayflowMetadataEvidenceBundleReadErrorV1 extends Error {
  readonly issueCode: DayflowMetadataEvidenceBundleReadIssueCodeV1;

  constructor(issueCode: DayflowMetadataEvidenceBundleReadIssueCodeV1) {
    super(`Dayflow metadata evidence bundle read failed (${issueCode})`);
    this.name = "DayflowMetadataEvidenceBundleReadErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: DayflowMetadataEvidenceBundleReadIssueCodeV1): never {
  throw new DayflowMetadataEvidenceBundleReadErrorV1(issueCode);
}

function snapshotInput(candidate: unknown): ReadDayflowMetadataEvidenceBundleV1Input {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    arrayIsArray(candidate) ||
    nodeUtilTypes.isProxy(candidate)
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  try {
    const prototype = objectGetPrototypeOf(candidate);
    if (prototype !== objectPrototype && prototype !== null) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const descriptors = objectGetOwnPropertyDescriptors(candidate);
    const keys = objectKeys(descriptors);
    const expected = ["bundleDirectoryName", "mode", "outputRoot"];
    if (
      keys.length !== expected.length ||
      !expected.every((key) => keys.includes(key))
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    const mode = descriptors.mode;
    const root = descriptors.outputRoot;
    const name = descriptors.bundleDirectoryName;
    if (
      mode === undefined ||
      !("value" in mode) ||
      mode.value !== "synthetic-task1-handoff" ||
      root === undefined ||
      !("value" in root) ||
      typeof root.value !== "string" ||
      name === undefined ||
      !("value" in name) ||
      typeof name.value !== "string"
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    if (
      !path.isAbsolute(root.value) ||
      path.normalize(root.value) !== root.value ||
      path.resolve(root.value) !== root.value ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name.value)
    ) {
      return fail("BUNDLE_INPUT_INVALID");
    }
    return {
      mode: "synthetic-task1-handoff",
      outputRoot: root.value,
      bundleDirectoryName: name.value,
    };
  } catch (error) {
    if (error instanceof DayflowMetadataEvidenceBundleReadErrorV1) {
      throw error;
    }
    return fail("BUNDLE_INPUT_INVALID");
  }
}

export async function readDayflowMetadataEvidenceBundleV1(
  input: ReadDayflowMetadataEvidenceBundleV1Input,
): Promise<ReadDayflowMetadataEvidenceBundleV1Result> {
  try {
    const snapshot = snapshotInput(input);
    const filesystem = await readDayflowMetadataEvidenceBundleFilesystemV1Internal({
      outputRoot: snapshot.outputRoot,
      bundleDirectoryName: snapshot.bundleDirectoryName,
    });
    const imported = importDayflowMetadataEvidenceBundleV1({
      mode: "synthetic-task1-handoff",
      bundleDirectoryName: snapshot.bundleDirectoryName,
      entries: filesystem.copySourceEntries(),
    });
    const bridgeDescriptor = objectFreeze({
      readSchemaVersion: DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_SCHEMA_VERSION,
      mode: "synthetic-task1-handoff" as const,
      bundleDirectoryName: snapshot.bundleDirectoryName,
      sourceOrder: DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
    });
    return objectFreeze({
      bridgeDescriptor,
      imported,
      sourceFiles: filesystem.sourceFiles,
      copySourceEntries: filesystem.copySourceEntries,
    });
  } catch (error) {
    if (error instanceof DayflowMetadataEvidenceBundleReadErrorV1) {
      throw error;
    }
    if (error instanceof DayflowMetadataEvidenceFilesystemReadErrorV1) {
      return fail(
        error.issueCode === "FILESYSTEM_INPUT_INVALID"
          ? "BUNDLE_INPUT_INVALID"
          : error.issueCode,
      );
    }
    if (error instanceof DayflowMetadataEvidenceImportErrorV1) {
      return fail("IMPORT_REJECTED");
    }
    return fail("FILESYSTEM_REJECTED");
  }
}
