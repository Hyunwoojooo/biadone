import { types as nodeUtilTypes } from "node:util";

import { domainSeparatedSha256 } from "../../dayflowEvidence/contracts";
import {
  DayflowMetadataEvidenceFilesystemReadErrorV1,
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
  readDayflowMetadataEvidenceBundleFilesystemV1Internal,
  type DayflowMetadataEvidenceBundleSourceFileV1,
} from "./dayflowMetadataEvidenceBundleFilesystemReadV1.internal";
import {
  DayflowMetadataEvidenceQualificationErrorV1,
  qualifyDayflowMetadataEvidenceBundleV1Internal,
  type DayflowMetadataEvidenceBundleEntryV1,
  type QualifiedDayflowMetadataEvidenceBundleV1,
} from "./dayflowMetadataEvidenceBundleQualificationV1.internal";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectKeys = Object.keys;
const objectPrototype = Object.prototype;
const arrayIsArray = Array.isArray;

export const DAYFLOW_PRIVATE_PILOT_READ_SCHEMA_VERSION =
  "blabase.dayflow-metadata-evidence-private-pilot-read.v1" as const;
export const DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_SCHEMA_VERSION =
  "blabase.dayflow-ablation.private-pilot-capture-binding.v1" as const;
export const DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_HASH_DOMAIN =
  "blabase.dayflow-ablation.private-pilot-capture-binding.v1" as const;
export const DAYFLOW_PRIVATE_PILOT_ID =
  "dayflow-ablation-private-pilot-v0.1" as const;
export const DAYFLOW_PRIVATE_PILOT_POLICY_SHA256 =
  "da6ff5f6a9c4a5f62b04e81fdee6acf65d251689b1a96c93d2b0fd8b1e0a5ff2" as const;

export interface DayflowPrivatePilotCaptureBindingV1 {
  readonly schemaVersion: typeof DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_SCHEMA_VERSION;
  readonly pilotId: typeof DAYFLOW_PRIVATE_PILOT_ID;
  readonly authorizationId: string;
  readonly policySha256: typeof DAYFLOW_PRIVATE_PILOT_POLICY_SHA256;
  readonly expectedExportRunId: string;
  readonly window: {
    readonly startEpochSecond: number;
    readonly endEpochSecond: number;
  };
}

export interface ReadPrivatePilotDayflowMetadataEvidenceBundleV1Input {
  readonly sourceMode: "real-private-pilot";
  readonly outputRoot: string;
  readonly bundleDirectoryName: string;
  readonly captureBinding: DayflowPrivatePilotCaptureBindingV1;
}

export interface DayflowPrivatePilotSourceDescriptorV1 {
  readonly readSchemaVersion: typeof DAYFLOW_PRIVATE_PILOT_READ_SCHEMA_VERSION;
  readonly sourceMode: "real-private-pilot";
  readonly bundleDirectoryName: string;
  readonly sourceOrder: typeof DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1;
  readonly captureBinding: DayflowPrivatePilotCaptureBindingV1;
  readonly captureBindingSha256: string;
  readonly wireProvenance: {
    readonly qualificationSchemaVersion: string;
    readonly exportRunId: string;
    readonly manifestSha256: string;
    readonly payloadSha256: string;
    readonly replayIdentitySha256: string;
  };
}

export interface ReadPrivatePilotDayflowMetadataEvidenceBundleV1Result {
  readonly sourceDescriptor: DayflowPrivatePilotSourceDescriptorV1;
  readonly qualified: QualifiedDayflowMetadataEvidenceBundleV1;
  readonly sourceFiles: readonly DayflowMetadataEvidenceBundleSourceFileV1[];
  copySourceEntries(): readonly DayflowMetadataEvidenceBundleEntryV1[];
}

export type DayflowPrivatePilotReadIssueCodeV1 =
  | "PRIVATE_PILOT_INPUT_INVALID"
  | "CAPTURE_BINDING_INVALID"
  | "OUTPUT_ROOT_UNSAFE"
  | "BUNDLE_DIRECTORY_UNSAFE"
  | "BUNDLE_INCOMPLETE"
  | "ENTRY_SET_MISMATCH"
  | "FILE_UNSAFE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "FILE_UNSTABLE"
  | "QUALIFICATION_REJECTED"
  | "CAPTURE_BINDING_MISMATCH"
  | "FILESYSTEM_REJECTED";

export class DayflowPrivatePilotReadErrorV1 extends Error {
  readonly issueCode: DayflowPrivatePilotReadIssueCodeV1;

  constructor(issueCode: DayflowPrivatePilotReadIssueCodeV1) {
    super(`Dayflow private pilot evidence read failed: ${issueCode}`);
    this.name = "DayflowPrivatePilotReadErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: DayflowPrivatePilotReadIssueCodeV1): never {
  throw new DayflowPrivatePilotReadErrorV1(issueCode);
}

function safeRecord(value: unknown): value is Record<string, unknown> {
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

function dataSnapshot(
  value: unknown,
  expectedKeys: readonly string[],
  issueCode: "PRIVATE_PILOT_INPUT_INVALID" | "CAPTURE_BINDING_INVALID",
): Record<string, unknown> {
  if (!safeRecord(value)) {
    return fail(issueCode);
  }
  let descriptors: ReturnType<typeof objectGetOwnPropertyDescriptors>;
  try {
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch {
    return fail(issueCode);
  }
  const keys = objectKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => keys.includes(key))
  ) {
    return fail(issueCode);
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail(issueCode);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotInput(
  candidate: unknown,
): ReadPrivatePilotDayflowMetadataEvidenceBundleV1Input {
  const root = dataSnapshot(
    candidate,
    ["bundleDirectoryName", "captureBinding", "outputRoot", "sourceMode"],
    "PRIVATE_PILOT_INPUT_INVALID",
  );
  if (
    root.sourceMode !== "real-private-pilot" ||
    typeof root.outputRoot !== "string" ||
    typeof root.bundleDirectoryName !== "string"
  ) {
    return fail("PRIVATE_PILOT_INPUT_INVALID");
  }
  const binding = dataSnapshot(
    root.captureBinding,
    [
      "authorizationId",
      "expectedExportRunId",
      "pilotId",
      "policySha256",
      "schemaVersion",
      "window",
    ],
    "CAPTURE_BINDING_INVALID",
  );
  const window = dataSnapshot(
    binding.window,
    ["endEpochSecond", "startEpochSecond"],
    "CAPTURE_BINDING_INVALID",
  );
  const start = window.startEpochSecond;
  const end = window.endEpochSecond;
  if (
    binding.schemaVersion !== DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_SCHEMA_VERSION ||
    binding.pilotId !== DAYFLOW_PRIVATE_PILOT_ID ||
    binding.policySha256 !== DAYFLOW_PRIVATE_PILOT_POLICY_SHA256 ||
    typeof binding.authorizationId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(binding.authorizationId) ||
    typeof binding.expectedExportRunId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(binding.expectedExportRunId) ||
    typeof start !== "number" ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    typeof end !== "number" ||
    !Number.isSafeInteger(end) ||
    end - start !== 599
  ) {
    return fail("CAPTURE_BINDING_INVALID");
  }
  const captureBinding = objectFreeze({
    schemaVersion: DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_SCHEMA_VERSION,
    pilotId: DAYFLOW_PRIVATE_PILOT_ID,
    authorizationId: binding.authorizationId,
    policySha256: DAYFLOW_PRIVATE_PILOT_POLICY_SHA256,
    expectedExportRunId: binding.expectedExportRunId,
    window: objectFreeze({ startEpochSecond: start, endEpochSecond: end }),
  });
  return {
    sourceMode: "real-private-pilot",
    outputRoot: root.outputRoot,
    bundleDirectoryName: root.bundleDirectoryName,
    captureBinding,
  };
}

export async function readPrivatePilotDayflowMetadataEvidenceBundleV1(
  input: ReadPrivatePilotDayflowMetadataEvidenceBundleV1Input,
): Promise<ReadPrivatePilotDayflowMetadataEvidenceBundleV1Result> {
  try {
    const snapshot = snapshotInput(input);
    if (snapshot.bundleDirectoryName !== snapshot.captureBinding.expectedExportRunId) {
      return fail("CAPTURE_BINDING_MISMATCH");
    }
    const filesystem = await readDayflowMetadataEvidenceBundleFilesystemV1Internal({
      outputRoot: snapshot.outputRoot,
      bundleDirectoryName: snapshot.bundleDirectoryName,
    });
    const qualified = qualifyDayflowMetadataEvidenceBundleV1Internal({
      bundleDirectoryName: snapshot.bundleDirectoryName,
      entries: filesystem.copySourceEntries(),
    });
    if (
      qualified.descriptor.exportRunId !== snapshot.captureBinding.expectedExportRunId ||
      qualified.evidence.window.startEpochSecond !==
        snapshot.captureBinding.window.startEpochSecond ||
      qualified.evidence.window.endEpochSecond !==
        snapshot.captureBinding.window.endEpochSecond ||
      qualified.evidence.window.endEpochSecond -
          qualified.evidence.window.startEpochSecond +
          1 !==
        600
    ) {
      return fail("CAPTURE_BINDING_MISMATCH");
    }
    const captureBindingSha256 = domainSeparatedSha256(
      DAYFLOW_PRIVATE_PILOT_CAPTURE_BINDING_HASH_DOMAIN,
      snapshot.captureBinding,
    );
    const sourceDescriptor = objectFreeze({
      readSchemaVersion: DAYFLOW_PRIVATE_PILOT_READ_SCHEMA_VERSION,
      sourceMode: "real-private-pilot" as const,
      bundleDirectoryName: snapshot.bundleDirectoryName,
      sourceOrder: DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1,
      captureBinding: snapshot.captureBinding,
      captureBindingSha256,
      wireProvenance: objectFreeze({
        qualificationSchemaVersion: qualified.descriptor.qualificationSchemaVersion,
        exportRunId: qualified.descriptor.exportRunId,
        manifestSha256: qualified.descriptor.manifestSha256,
        payloadSha256: qualified.descriptor.payloadSha256,
        replayIdentitySha256: qualified.descriptor.replayIdentitySha256,
      }),
    });
    return objectFreeze({
      sourceDescriptor,
      qualified,
      sourceFiles: filesystem.sourceFiles,
      copySourceEntries: filesystem.copySourceEntries,
    });
  } catch (error) {
    if (error instanceof DayflowPrivatePilotReadErrorV1) {
      throw error;
    }
    if (error instanceof DayflowMetadataEvidenceFilesystemReadErrorV1) {
      return fail(
        error.issueCode === "FILESYSTEM_INPUT_INVALID"
          ? "PRIVATE_PILOT_INPUT_INVALID"
          : error.issueCode,
      );
    }
    if (error instanceof DayflowMetadataEvidenceQualificationErrorV1) {
      return fail("QUALIFICATION_REJECTED");
    }
    return fail("FILESYSTEM_REJECTED");
  }
}
