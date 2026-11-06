import { types as nodeUtilTypes } from "node:util";

import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../../dayflowEvidence/contracts";
import {
  canonicalJsonLfBytes,
  publishPrivateEvaluationArtifactSetNoClobber,
  rawSha256,
  verifyPrivateEvaluationArtifactSetReadback,
} from "../privateArtifactStore";
import type {
  PrivateEvaluationArtifactSetFile,
  VerifiedPrivateEvaluationArtifactSet,
} from "../privateArtifactStore";
import type { StructuredCurrentWorkEvidenceDescriptorV1 } from "./captureStructuredCurrentWorkEvidenceV1";
import {
  importDayflowMetadataEvidenceBundleV1,
} from "./importDayflowMetadataEvidenceBundleV1";
import type {
  DayflowMetadataEvidenceBundleEntryV1,
  ImportedDayflowMetadataEvidenceBundleV1,
  ImportedDayflowMetadataEvidenceDescriptorV1,
} from "./importDayflowMetadataEvidenceBundleV1";

export const TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1-evaluation-input-manifest.v0.1" as const;
export const TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN =
  "blabase.dayflow-ablation.task1-evaluation-input.v0.1" as const;
export const TASK1C_POLICY_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1c-policy.v0.1" as const;
export const TASK1C_POLICY_ID =
  "dayflow-ablation-private-pilot-v0.1" as const;
export const TASK1C_POLICY_RELATIVE_PATH =
  "policy/pilot-input-policy.json" as const;
export const TASK1C_POLICY_SHA256 =
  "da6ff5f6a9c4a5f62b04e81fdee6acf65d251689b1a96c93d2b0fd8b1e0a5ff2" as const;

const STRUCTURED_STORED_PATH = "structured-evidence.json" as const;
const DAYFLOW_SOURCE_PATHS = Object.freeze([
  "payload.json",
  "manifest.json",
  "manifest.sha256",
  "COMPLETE",
] as const);
const STORED_FILE_PATHS = Object.freeze([
  STRUCTURED_STORED_PATH,
  "dayflow-source-payload.json",
  "dayflow-source-manifest.json",
  "dayflow-source-manifest.sha256",
  "dayflow-source-COMPLETE",
  "evaluation-input-manifest.json",
  "evaluation-input-manifest.sha256",
  "COMPLETE",
] as const);
const DAYFLOW_STORED_PATH_BY_SOURCE = Object.freeze({
  "payload.json": STORED_FILE_PATHS[1],
  "manifest.json": STORED_FILE_PATHS[2],
  "manifest.sha256": STORED_FILE_PATHS[3],
  COMPLETE: STORED_FILE_PATHS[4],
} as const);
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const encoder = new TextEncoder();
const builtSealBrand = new WeakSet<object>();

export type Task1EvaluationInputSealIssueCodeV1 =
  | "INPUT_INVALID"
  | "WINDOW_INVALID"
  | "STRUCTURED_EVIDENCE_INVALID"
  | "DAYFLOW_SOURCE_INVALID"
  | "DAYFLOW_DESCRIPTOR_MISMATCH"
  | "PUBLICATION_FAILED"
  | "VERIFICATION_FAILED";

export class Task1EvaluationInputSealErrorV1 extends Error {
  readonly issueCode: Task1EvaluationInputSealIssueCodeV1;

  constructor(issueCode: Task1EvaluationInputSealIssueCodeV1) {
    super(`Task 1 evaluation input seal failed (${issueCode})`);
    this.name = "Task1EvaluationInputSealErrorV1";
    this.issueCode = issueCode;
  }
}

export type Task1EvaluationInputWindowV1 = Readonly<{
  startEpochSecond: number;
  endEpochSecond: number;
}>;

export type BuildTask1EvaluationInputSealV1Input = Readonly<{
  window: Task1EvaluationInputWindowV1;
  structured: StructuredCurrentWorkEvidenceDescriptorV1;
  dayflow: Readonly<{
    imported: ImportedDayflowMetadataEvidenceBundleV1;
    copySourceEntries: () => readonly DayflowMetadataEvidenceBundleEntryV1[];
  }>;
}>;

export type Task1EvaluationInputSourceFileMappingV1 = Readonly<{
  sourceRelativePath: (typeof DAYFLOW_SOURCE_PATHS)[number];
  storedRelativePath:
    (typeof DAYFLOW_STORED_PATH_BY_SOURCE)[keyof typeof DAYFLOW_STORED_PATH_BY_SOURCE];
  byteLength: number;
  rawSha256: string;
}>;

export type Task1EvaluationInputManifestV1 = Readonly<{
  schemaVersion: typeof TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION;
  policy: Readonly<{
    schemaVersion: typeof TASK1C_POLICY_SCHEMA_VERSION;
    policyId: typeof TASK1C_POLICY_ID;
    relativePath: typeof TASK1C_POLICY_RELATIVE_PATH;
    sha256: typeof TASK1C_POLICY_SHA256;
  }>;
  window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
    durationSeconds: 600;
    semantics: "inclusive";
  }>;
  structured: Readonly<{
    schemaVersion: StructuredCurrentWorkEvidenceDescriptorV1["schemaVersion"];
    asOf: string;
    githubMode: "configured_available" | "unconfigured";
    storedRelativePath: typeof STRUCTURED_STORED_PATH;
    byteLength: number;
    rawSha256: string;
    contentSha256: string;
  }>;
  dayflow: Readonly<{
    descriptor: ImportedDayflowMetadataEvidenceDescriptorV1;
    sourceFiles: readonly Task1EvaluationInputSourceFileMappingV1[];
  }>;
  canonicalization: Readonly<{
    storedManifest: "rfc8785-jcs.utf8.lf.v1";
    identityHashDomain: typeof TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN;
    identityPreimage: "manifest-without-self-hash-or-publication-metadata";
  }>;
}>;

export type BuiltTask1EvaluationInputSealV1 = Readonly<{
  descriptor: Readonly<{
    manifestSchemaVersion:
      typeof TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION;
    identityHashDomain: typeof TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN;
    identitySha256: string;
    manifestByteLength: number;
    manifestRawSha256: string;
  }>;
  manifest: Task1EvaluationInputManifestV1;
  copyArtifactFiles: () => readonly PrivateEvaluationArtifactSetFile[];
}>;

type OwnedSourceEntry = Readonly<{
  relativePath: (typeof DAYFLOW_SOURCE_PATHS)[number];
  byteLength: number;
  bytes: Uint8Array;
  rawSha256: string;
}>;

type StoredFile = Readonly<{
  relativePath: (typeof STORED_FILE_PATHS)[number];
  mediaType: string;
  bytes: Uint8Array;
  rawSha256: string;
}>;

function fail(issueCode: Task1EvaluationInputSealIssueCodeV1): never {
  throw new Task1EvaluationInputSealErrorV1(issueCode);
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isGenuineUint8Array(value: unknown): value is Uint8Array {
  return (
    value !== null &&
    typeof value === "object" &&
    !nodeUtilTypes.isProxy(value) &&
    nodeUtilTypes.isUint8Array(value) &&
    Object.getPrototypeOf(value) === Uint8Array.prototype
  );
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function record(value: unknown): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeUtilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function validateWindow(window: Task1EvaluationInputWindowV1): Readonly<{
  startEpochSecond: number;
  endEpochSecond: number;
  asOf: string;
}> {
  if (
    window === null ||
    typeof window !== "object" ||
    !Number.isSafeInteger(window.startEpochSecond) ||
    !Number.isSafeInteger(window.endEpochSecond) ||
    window.startEpochSecond < 0 ||
    window.endEpochSecond !== window.startEpochSecond + 599
  ) {
    return fail("WINDOW_INVALID");
  }
  const endMilliseconds = window.endEpochSecond * 1_000;
  if (!Number.isSafeInteger(endMilliseconds)) return fail("WINDOW_INVALID");
  const endDate = new Date(endMilliseconds);
  if (!Number.isFinite(endDate.getTime())) return fail("WINDOW_INVALID");
  return Object.freeze({
    startEpochSecond: window.startEpochSecond,
    endEpochSecond: window.endEpochSecond,
    asOf: endDate.toISOString(),
  });
}

function validateStructuredDescriptor(
  descriptor: StructuredCurrentWorkEvidenceDescriptorV1,
  expectedAsOf: string,
): Readonly<{
  descriptor: StructuredCurrentWorkEvidenceDescriptorV1;
  bytes: Uint8Array;
  rawSha256: string;
}> {
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    nodeUtilTypes.isProxy(descriptor) ||
    descriptor.schemaVersion !==
      "blabase.dayflow-ablation.structured-current-work-evidence.v1" ||
    descriptor.asOf !== expectedAsOf ||
    (descriptor.githubMode !== "configured_available" &&
      descriptor.githubMode !== "unconfigured") ||
    typeof descriptor.canonicalJson !== "string" ||
    !Number.isSafeInteger(descriptor.canonicalJsonByteLength) ||
    descriptor.canonicalJsonByteLength < 1 ||
    typeof descriptor.sha256 !== "string" ||
    !SHA256_HEX.test(descriptor.sha256)
  ) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(descriptor.canonicalJson) as unknown;
  } catch {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  let canonical: string;
  try {
    canonical = jcsCanonicalize(parsed);
  } catch {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  const root = record(parsed);
  const sourceState = record(root?.sourceState);
  const currentWorkEvidence = record(root?.currentWorkEvidence);
  if (
    canonical !== descriptor.canonicalJson ||
    root?.schemaVersion !== descriptor.schemaVersion ||
    sourceState?.github !== descriptor.githubMode ||
    currentWorkEvidence?.asOf !== expectedAsOf ||
    domainSeparatedSha256(descriptor.schemaVersion, parsed) !==
      descriptor.sha256
  ) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  const bytes = encoder.encode(descriptor.canonicalJson);
  if (bytes.byteLength !== descriptor.canonicalJsonByteLength) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  return Object.freeze({
    descriptor,
    bytes,
    rawSha256: rawSha256(bytes),
  });
}

function copyAndValidateDayflowSourceEntries(
  entries: readonly DayflowMetadataEvidenceBundleEntryV1[],
): readonly OwnedSourceEntry[] {
  if (!Array.isArray(entries) || entries.length !== DAYFLOW_SOURCE_PATHS.length) {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  const copies: OwnedSourceEntry[] = [];
  for (let index = 0; index < DAYFLOW_SOURCE_PATHS.length; index += 1) {
    const entry = entries[index];
    const expectedPath = DAYFLOW_SOURCE_PATHS[index]!;
    if (
      entry === undefined ||
      entry === null ||
      typeof entry !== "object" ||
      nodeUtilTypes.isProxy(entry) ||
      entry.relativePath !== expectedPath ||
      entry.entryKind !== "regular-file" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      !isGenuineUint8Array(entry.bytes) ||
      entry.bytes.byteLength !== entry.byteLength
    ) {
      return fail("DAYFLOW_SOURCE_INVALID");
    }
    const bytes = copyBytes(entry.bytes);
    copies.push(
      Object.freeze({
        relativePath: expectedPath,
        byteLength: bytes.byteLength,
        bytes,
        rawSha256: rawSha256(bytes),
      }),
    );
  }
  return Object.freeze(copies);
}

function descriptorsEqual(
  left: ImportedDayflowMetadataEvidenceDescriptorV1,
  right: ImportedDayflowMetadataEvidenceDescriptorV1,
): boolean {
  return (
    left.importSchemaVersion === right.importSchemaVersion &&
    left.exportRunId === right.exportRunId &&
    left.manifestByteCount === right.manifestByteCount &&
    left.manifestSha256 === right.manifestSha256 &&
    left.payloadByteCount === right.payloadByteCount &&
    left.payloadSha256 === right.payloadSha256 &&
    left.replayIdentitySha256 === right.replayIdentitySha256
  );
}

function validateDayflow(
  dayflow: BuildTask1EvaluationInputSealV1Input["dayflow"],
  window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
  }>,
): Readonly<{
  descriptor: ImportedDayflowMetadataEvidenceDescriptorV1;
  sources: readonly OwnedSourceEntry[];
}> {
  if (
    dayflow === null ||
    typeof dayflow !== "object" ||
    nodeUtilTypes.isProxy(dayflow) ||
    dayflow.imported === null ||
    typeof dayflow.imported !== "object" ||
    nodeUtilTypes.isProxy(dayflow.imported) ||
    dayflow.imported.descriptor === null ||
    typeof dayflow.imported.descriptor !== "object" ||
    nodeUtilTypes.isProxy(dayflow.imported.descriptor) ||
    typeof dayflow.copySourceEntries !== "function"
  ) {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  let freshSourceEntries: readonly DayflowMetadataEvidenceBundleEntryV1[];
  try {
    freshSourceEntries = dayflow.copySourceEntries();
  } catch {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  const sources = copyAndValidateDayflowSourceEntries(freshSourceEntries);
  let qualified: ReturnType<typeof importDayflowMetadataEvidenceBundleV1>;
  try {
    qualified = importDayflowMetadataEvidenceBundleV1({
      mode: "synthetic-task1-handoff",
      bundleDirectoryName: dayflow.imported.descriptor.exportRunId,
      entries: sources.map((source) => ({
        relativePath: source.relativePath,
        entryKind: "regular-file" as const,
        byteLength: source.byteLength,
        bytes: copyBytes(source.bytes),
      })),
    });
  } catch {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  if (!descriptorsEqual(dayflow.imported.descriptor, qualified.descriptor)) {
    return fail("DAYFLOW_DESCRIPTOR_MISMATCH");
  }
  if (
    qualified.evidence.window.startEpochSecond !== window.startEpochSecond ||
    qualified.evidence.window.endEpochSecond !== window.endEpochSecond
  ) {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  return Object.freeze({
    descriptor: qualified.descriptor,
    sources,
  });
}

function makeStoredFile(
  relativePath: (typeof STORED_FILE_PATHS)[number],
  mediaType: string,
  bytes: Uint8Array,
): StoredFile {
  const ownedBytes = copyBytes(bytes);
  return Object.freeze({
    relativePath,
    mediaType,
    bytes: ownedBytes,
    rawSha256: rawSha256(ownedBytes),
  });
}

function copyStoredFiles(
  storedFiles: readonly StoredFile[],
): readonly PrivateEvaluationArtifactSetFile[] {
  return Object.freeze(
    storedFiles.map((file) => {
      const bytes = copyBytes(file.bytes);
      return Object.freeze({
        relativePath: file.relativePath,
        mediaType: file.mediaType,
        byteLength: bytes.byteLength,
        rawSha256: file.rawSha256,
        bytes,
      });
    }),
  );
}

function buildInternal(
  input: BuildTask1EvaluationInputSealV1Input,
): BuiltTask1EvaluationInputSealV1 {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeUtilTypes.isProxy(input)
  ) {
    return fail("INPUT_INVALID");
  }
  const window = validateWindow(input.window);
  const structured = validateStructuredDescriptor(input.structured, window.asOf);
  const dayflow = validateDayflow(input.dayflow, window);
  const sourceFiles = Object.freeze(
    dayflow.sources.map((source) =>
      Object.freeze({
        sourceRelativePath: source.relativePath,
        storedRelativePath: DAYFLOW_STORED_PATH_BY_SOURCE[source.relativePath],
        byteLength: source.byteLength,
        rawSha256: source.rawSha256,
      }),
    ),
  );
  const manifest = deepFreeze<Task1EvaluationInputManifestV1>({
    schemaVersion: TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
    policy: {
      schemaVersion: TASK1C_POLICY_SCHEMA_VERSION,
      policyId: TASK1C_POLICY_ID,
      relativePath: TASK1C_POLICY_RELATIVE_PATH,
      sha256: TASK1C_POLICY_SHA256,
    },
    window: {
      startEpochSecond: window.startEpochSecond,
      endEpochSecond: window.endEpochSecond,
      durationSeconds: 600,
      semantics: "inclusive",
    },
    structured: {
      schemaVersion: structured.descriptor.schemaVersion,
      asOf: structured.descriptor.asOf,
      githubMode: structured.descriptor.githubMode,
      storedRelativePath: STRUCTURED_STORED_PATH,
      byteLength: structured.bytes.byteLength,
      rawSha256: structured.rawSha256,
      contentSha256: structured.descriptor.sha256,
    },
    dayflow: {
      descriptor: {
        importSchemaVersion: dayflow.descriptor.importSchemaVersion,
        exportRunId: dayflow.descriptor.exportRunId,
        manifestByteCount: dayflow.descriptor.manifestByteCount,
        manifestSha256: dayflow.descriptor.manifestSha256,
        payloadByteCount: dayflow.descriptor.payloadByteCount,
        payloadSha256: dayflow.descriptor.payloadSha256,
        replayIdentitySha256: dayflow.descriptor.replayIdentitySha256,
      },
      sourceFiles,
    },
    canonicalization: {
      storedManifest: "rfc8785-jcs.utf8.lf.v1",
      identityHashDomain: TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
      identityPreimage:
        "manifest-without-self-hash-or-publication-metadata",
    },
  });
  const identitySha256 = domainSeparatedSha256(
    TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
    manifest,
  );
  const manifestBytes = canonicalJsonLfBytes(manifest);
  const identityBytes = encoder.encode(identitySha256);
  const storedFiles = Object.freeze([
    makeStoredFile(STORED_FILE_PATHS[0], "application/json", structured.bytes),
    makeStoredFile(STORED_FILE_PATHS[1], "application/json", dayflow.sources[0]!.bytes),
    makeStoredFile(STORED_FILE_PATHS[2], "application/json", dayflow.sources[1]!.bytes),
    makeStoredFile(STORED_FILE_PATHS[3], "text/plain; charset=us-ascii", dayflow.sources[2]!.bytes),
    makeStoredFile(STORED_FILE_PATHS[4], "text/plain; charset=us-ascii", dayflow.sources[3]!.bytes),
    makeStoredFile(STORED_FILE_PATHS[5], "application/json", manifestBytes),
    makeStoredFile(STORED_FILE_PATHS[6], "text/plain; charset=us-ascii", identityBytes),
    makeStoredFile(STORED_FILE_PATHS[7], "text/plain; charset=us-ascii", identityBytes),
  ]);
  const result = Object.freeze({
    descriptor: Object.freeze({
      manifestSchemaVersion: TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
      identityHashDomain: TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
      identitySha256,
      manifestByteLength: manifestBytes.byteLength,
      manifestRawSha256: rawSha256(manifestBytes),
    }),
    manifest,
    copyArtifactFiles: () => copyStoredFiles(storedFiles),
  });
  builtSealBrand.add(result);
  return result;
}

export function buildTask1EvaluationInputSealV1(
  input: BuildTask1EvaluationInputSealV1Input,
): BuiltTask1EvaluationInputSealV1 {
  try {
    return buildInternal(input);
  } catch (error) {
    if (error instanceof Task1EvaluationInputSealErrorV1) throw error;
    return fail("INPUT_INVALID");
  }
}

function pathComponentsFor(
  seal: BuiltTask1EvaluationInputSealV1,
): readonly string[] {
  if (!builtSealBrand.has(seal)) return fail("INPUT_INVALID");
  return Object.freeze([
    ".local",
    "dayflow-ablation",
    "inputs",
    TASK1C_POLICY_ID,
    "runs",
    seal.descriptor.identitySha256,
  ]);
}

function freezeVerifiedArtifactSet(
  value: VerifiedPrivateEvaluationArtifactSet,
): VerifiedPrivateEvaluationArtifactSet {
  return Object.freeze({
    relativeDirectory: value.relativeDirectory,
    directoryMode: value.directoryMode,
    files: Object.freeze(
      value.files.map((file) =>
        Object.freeze({
          relativePath: file.relativePath,
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          rawSha256: file.rawSha256,
          mode: file.mode,
        }),
      ),
    ),
  });
}

export async function publishTask1EvaluationInputSealV1(input: Readonly<{
  dataRoot: string;
  seal: BuiltTask1EvaluationInputSealV1;
}>): Promise<VerifiedPrivateEvaluationArtifactSet> {
  try {
    const pathComponents = pathComponentsFor(input.seal);
    const verified = await publishPrivateEvaluationArtifactSetNoClobber({
      dataRoot: input.dataRoot,
      pathComponents,
      files: input.seal.copyArtifactFiles(),
    });
    return freezeVerifiedArtifactSet(verified);
  } catch (error) {
    if (
      error instanceof Task1EvaluationInputSealErrorV1 &&
      error.issueCode === "INPUT_INVALID"
    ) {
      throw error;
    }
    return fail("PUBLICATION_FAILED");
  }
}

export async function verifyPublishedTask1EvaluationInputSealV1(input: Readonly<{
  dataRoot: string;
  seal: BuiltTask1EvaluationInputSealV1;
}>): Promise<VerifiedPrivateEvaluationArtifactSet> {
  try {
    const pathComponents = pathComponentsFor(input.seal);
    const verified = await verifyPrivateEvaluationArtifactSetReadback({
      dataRoot: input.dataRoot,
      pathComponents,
      expectedFiles: input.seal.copyArtifactFiles(),
    });
    return freezeVerifiedArtifactSet(verified);
  } catch (error) {
    if (
      error instanceof Task1EvaluationInputSealErrorV1 &&
      error.issueCode === "INPUT_INVALID"
    ) {
      throw error;
    }
    return fail("VERIFICATION_FAILED");
  }
}
