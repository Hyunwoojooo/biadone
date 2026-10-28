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

export const PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1-private-pilot-authorization.v0.1" as const;
export const PRIVATE_PILOT_TASK1_POLICY_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1c-policy.v0.1" as const;
export const PRIVATE_PILOT_TASK1_POLICY_ID =
  "dayflow-ablation-private-pilot-v0.1" as const;
export const PRIVATE_PILOT_TASK1_POLICY_SHA256 =
  "da6ff5f6a9c4a5f62b04e81fdee6acf65d251689b1a96c93d2b0fd8b1e0a5ff2" as const;
export const PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION =
  "blabase.dayflow-metadata-evidence-private-pilot-read.v1" as const;
export const PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1-evaluation-input-manifest.v0.2" as const;
export const PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN =
  "blabase.dayflow-ablation.task1-evaluation-input.v0.2" as const;

const SYNTHETIC_IMPORT_SCHEMA_VERSION =
  "dayflow.blabase-evidence-bundle-import.v1";
const SOURCE_MODE = "real-private-pilot" as const;
const SOURCE_PATHS = Object.freeze([
  "payload.json",
  "manifest.json",
  "manifest.sha256",
  "COMPLETE",
] as const);
const STORED_PATHS = Object.freeze([
  "authorization.json",
  "authorization.sha256",
  "structured-evidence.json",
  "dayflow-source-payload.json",
  "dayflow-source-manifest.json",
  "dayflow-source-manifest.sha256",
  "dayflow-source-COMPLETE",
  "evaluation-input-manifest.json",
  "evaluation-input-manifest.sha256",
  "COMPLETE",
] as const);
const STORED_DAYFLOW_PATHS = Object.freeze({
  "payload.json": STORED_PATHS[3],
  "manifest.json": STORED_PATHS[4],
  "manifest.sha256": STORED_PATHS[5],
  COMPLETE: STORED_PATHS[6],
} as const);
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const VERSION_TOKEN = /^[A-Za-z0-9._-]{1,160}$/u;
const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const builtSealBrand = new WeakSet<object>();

export type PrivatePilotTask1EvaluationInputSealIssueCodeV0_2 =
  | "INPUT_INVALID"
  | "AUTHORIZATION_INVALID"
  | "POLICY_MISMATCH"
  | "SOURCE_MODE_MISMATCH"
  | "WINDOW_MISMATCH"
  | "STRUCTURED_EVIDENCE_INVALID"
  | "DAYFLOW_SOURCE_INVALID"
  | "DAYFLOW_QUALIFICATION_INVALID"
  | "PUBLICATION_FAILED"
  | "VERIFICATION_FAILED";

export class PrivatePilotTask1EvaluationInputSealErrorV0_2 extends Error {
  readonly issueCode: PrivatePilotTask1EvaluationInputSealIssueCodeV0_2;

  constructor(issueCode: PrivatePilotTask1EvaluationInputSealIssueCodeV0_2) {
    super(`Private-pilot Task 1 evaluation input V0.2 failed (${issueCode})`);
    this.name = "PrivatePilotTask1EvaluationInputSealErrorV0_2";
    this.issueCode = issueCode;
  }
}

type JsonPrimitive = string | number | boolean | null;
export type PrivatePilotTask1CanonicalJsonValue =
  | JsonPrimitive
  | readonly PrivatePilotTask1CanonicalJsonValue[]
  | Readonly<{ [key: string]: PrivatePilotTask1CanonicalJsonValue }>;
export type PrivatePilotTask1CanonicalJsonObject = Readonly<{
  [key: string]: PrivatePilotTask1CanonicalJsonValue;
}>;

export type PrivatePilotTask1AuthorizationBindingV0_2 = Readonly<{
  descriptor: Readonly<{
    schemaVersion: typeof PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION;
    identityHashDomain: string;
    identitySha256: string;
    authorizationByteLength: number;
    authorizationRawSha256: string;
    episodeId: string;
    sourceMode: typeof SOURCE_MODE;
    expectedExportRunId: string;
    startEpochSecond: number;
    endEpochSecond: number;
    asOf: string;
  }>;
  authorization: unknown;
  copyArtifactFiles: () => readonly PrivateEvaluationArtifactSetFile[];
}>;

export type PrivatePilotTask1SourceEntryV0_2 = Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}>;

export type PrivatePilotTask1QualificationDescriptorV0_2 = Readonly<{
  qualificationSchemaVersion: string;
  exportRunId: string;
  manifestByteCount: number;
  manifestSha256: string;
  payloadByteCount: number;
  payloadSha256: string;
  replayIdentitySha256: string;
}>;

export type PrivatePilotTask1RealReaderBindingV0_2 = Readonly<{
  sourceDescriptor: Readonly<{
    readSchemaVersion: typeof PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION;
    sourceMode: typeof SOURCE_MODE;
    bundleDirectoryName: string;
    sourceOrder: readonly string[];
    captureBinding: unknown;
    captureBindingSha256: string;
    wireProvenance: unknown;
  }>;
  qualified: Readonly<{
    descriptor: PrivatePilotTask1QualificationDescriptorV0_2;
    manifest: unknown;
    evidence: Readonly<{
      window: Readonly<{
        startEpochSecond: number;
        endEpochSecond: number;
      }>;
    }>;
  }>;
  sourceFiles: readonly Readonly<{
    relativePath: string;
    entryKind: "regular-file";
    byteLength: number;
    rawSha256: string;
  }>[];
  copySourceEntries: () => readonly PrivatePilotTask1SourceEntryV0_2[];
}>;

export type BuildPrivatePilotTask1EvaluationInputSealV0_2Input = Readonly<{
  authorization: PrivatePilotTask1AuthorizationBindingV0_2;
  structured: StructuredCurrentWorkEvidenceDescriptorV1;
  dayflow: PrivatePilotTask1RealReaderBindingV0_2;
}>;

export type PrivatePilotTask1EvaluationInputManifestV0_2 = Readonly<{
  schemaVersion:
    typeof PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION;
  authorization: Readonly<{
    schemaVersion: typeof PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION;
    identityHashDomain: string;
    identitySha256: string;
    byteLength: number;
    rawSha256: string;
    authorizedBy: "colin";
    decision: "authorized";
    authorizedAt: string;
    episodeId: string;
    expectedExportRunId: string;
  }>;
  policy: Readonly<{
    schemaVersion: typeof PRIVATE_PILOT_TASK1_POLICY_SCHEMA_VERSION;
    policyId: typeof PRIVATE_PILOT_TASK1_POLICY_ID;
    sha256: typeof PRIVATE_PILOT_TASK1_POLICY_SHA256;
  }>;
  sourceMode: typeof SOURCE_MODE;
  window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
    durationSeconds: 600;
    semantics: "inclusive";
    asOf: string;
  }>;
  authorizationControls: Readonly<{
    handling: PrivatePilotTask1CanonicalJsonObject;
    structuredEvidence: PrivatePilotTask1CanonicalJsonObject;
    privacy: PrivatePilotTask1CanonicalJsonObject;
    quality: PrivatePilotTask1CanonicalJsonObject;
    retention: PrivatePilotTask1RetentionV0_2;
    failurePolicy: PrivatePilotTask1CanonicalJsonObject;
  }>;
  structured: Readonly<{
    schemaVersion: StructuredCurrentWorkEvidenceDescriptorV1["schemaVersion"];
    asOf: string;
    githubMode: "configured_available" | "unconfigured";
    storedRelativePath: "structured-evidence.json";
    byteLength: number;
    rawSha256: string;
    contentSha256: string;
  }>;
  dayflow: Readonly<{
    read: Readonly<{
      readSchemaVersion: typeof PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION;
      sourceMode: typeof SOURCE_MODE;
      bundleDirectoryName: string;
      sourceOrder: readonly (typeof SOURCE_PATHS)[number][];
      captureBinding: PrivatePilotTask1CanonicalJsonObject;
      captureBindingSha256: string;
      wireProvenance: PrivatePilotTask1CanonicalJsonObject;
    }>;
    qualification: PrivatePilotTask1QualificationDescriptorV0_2;
    sourceFiles: readonly Readonly<{
      sourceRelativePath: (typeof SOURCE_PATHS)[number];
      storedRelativePath:
        (typeof STORED_DAYFLOW_PATHS)[keyof typeof STORED_DAYFLOW_PATHS];
      byteLength: number;
      rawSha256: string;
    }>[];
  }>;
  canonicalization: Readonly<{
    authorization: PrivatePilotTask1CanonicalJsonObject;
    storedManifest: "rfc8785-jcs.utf8.lf.v1";
    identityHashDomain:
      typeof PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN;
    identityPreimage: "manifest-without-self-hash-or-publication-metadata";
  }>;
}>;

export type BuiltPrivatePilotTask1EvaluationInputSealV0_2 = Readonly<{
  descriptor: Readonly<{
    manifestSchemaVersion:
      typeof PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION;
    identityHashDomain:
      typeof PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN;
    identitySha256: string;
    manifestByteLength: number;
    manifestRawSha256: string;
    authorizationIdentitySha256: string;
    sourceMode: typeof SOURCE_MODE;
    startEpochSecond: number;
    endEpochSecond: number;
    asOf: string;
  }>;
  manifest: PrivatePilotTask1EvaluationInputManifestV0_2;
  copyArtifactFiles: () => readonly PrivateEvaluationArtifactSetFile[];
}>;

type OwnedSource = Readonly<{
  relativePath: (typeof SOURCE_PATHS)[number];
  bytes: Uint8Array;
  rawSha256: string;
}>;

type StoredFile = Readonly<{
  relativePath: (typeof STORED_PATHS)[number];
  mediaType: string;
  bytes: Uint8Array;
  rawSha256: string;
}>;

function fail(
  issueCode: PrivatePilotTask1EvaluationInputSealIssueCodeV0_2,
): never {
  throw new PrivatePilotTask1EvaluationInputSealErrorV0_2(issueCode);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !nodeUtilTypes.isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isGenuineBytes(value: unknown): value is Uint8Array {
  return (
    value !== null &&
    typeof value === "object" &&
    !nodeUtilTypes.isProxy(value) &&
    nodeUtilTypes.isUint8Array(value) &&
    Object.getPrototypeOf(value) === Uint8Array.prototype
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function asCanonicalObject(
  value: unknown,
  issueCode: PrivatePilotTask1EvaluationInputSealIssueCodeV0_2,
): PrivatePilotTask1CanonicalJsonObject {
  if (!isPlainRecord(value)) return fail(issueCode);
  try {
    jcsCanonicalize(value);
  } catch {
    return fail(issueCode);
  }
  return deepFreeze(value as PrivatePilotTask1CanonicalJsonObject);
}

function exactAsciiSha256(bytes: Uint8Array): string | null {
  if (bytes.byteLength !== 64) return null;
  let value = "";
  for (const byte of bytes) {
    if (!((byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102))) {
      return null;
    }
    value += String.fromCharCode(byte);
  }
  return value;
}

function validWindow(
  startEpochSecond: unknown,
  endEpochSecond: unknown,
  asOf: unknown,
): startEpochSecond is number {
  if (
    !Number.isSafeInteger(startEpochSecond) ||
    !Number.isSafeInteger(endEpochSecond) ||
    typeof startEpochSecond !== "number" ||
    typeof endEpochSecond !== "number" ||
    startEpochSecond < 0 ||
    endEpochSecond !== startEpochSecond + 599 ||
    typeof asOf !== "string"
  ) {
    return false;
  }
  const milliseconds = endEpochSecond * 1_000;
  return (
    Number.isSafeInteger(milliseconds) &&
    Number.isFinite(new Date(milliseconds).getTime()) &&
    new Date(milliseconds).toISOString() === asOf
  );
}

function validateAuthorization(
  binding: PrivatePilotTask1AuthorizationBindingV0_2,
): Readonly<{
  descriptor: PrivatePilotTask1AuthorizationBindingV0_2["descriptor"];
  record: PrivatePilotTask1CanonicalJsonObject;
  bytes: Uint8Array;
  authorization: Record<string, unknown>;
  policy: Record<string, unknown>;
  window: Record<string, unknown>;
  handling: PrivatePilotTask1CanonicalJsonObject;
  structuredEvidence: PrivatePilotTask1CanonicalJsonObject;
  privacy: PrivatePilotTask1CanonicalJsonObject;
  quality: PrivatePilotTask1CanonicalJsonObject;
  retention: PrivatePilotTask1RetentionV0_2;
  failurePolicy: PrivatePilotTask1CanonicalJsonObject;
  canonicalization: PrivatePilotTask1CanonicalJsonObject;
}> {
  if (
    binding === null ||
    typeof binding !== "object" ||
    nodeUtilTypes.isProxy(binding) ||
    binding.descriptor === null ||
    typeof binding.descriptor !== "object" ||
    nodeUtilTypes.isProxy(binding.descriptor) ||
    typeof binding.copyArtifactFiles !== "function"
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  const descriptor = binding.descriptor;
  if (
    descriptor.schemaVersion !==
      PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION ||
    descriptor.sourceMode !== SOURCE_MODE ||
    typeof descriptor.identityHashDomain !== "string" ||
    !VERSION_TOKEN.test(descriptor.identityHashDomain) ||
    !SHA256_HEX.test(descriptor.identitySha256) ||
    !SHA256_HEX.test(descriptor.authorizationRawSha256) ||
    !Number.isSafeInteger(descriptor.authorizationByteLength) ||
    descriptor.authorizationByteLength < 1 ||
    typeof descriptor.episodeId !== "string" ||
    descriptor.episodeId.length < 1 ||
    typeof descriptor.expectedExportRunId !== "string" ||
    descriptor.expectedExportRunId.length < 1 ||
    !validWindow(
      descriptor.startEpochSecond,
      descriptor.endEpochSecond,
      descriptor.asOf,
    )
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  let files: readonly PrivateEvaluationArtifactSetFile[];
  try {
    files = binding.copyArtifactFiles();
  } catch {
    return fail("AUTHORIZATION_INVALID");
  }
  if (
    !Array.isArray(files) ||
    files.length !== 3 ||
    files[0]?.relativePath !== "authorization.json" ||
    files[1]?.relativePath !== "authorization.sha256" ||
    files[2]?.relativePath !== "COMPLETE" ||
    !isGenuineBytes(files[0].bytes) ||
    !isGenuineBytes(files[1].bytes) ||
    !isGenuineBytes(files[2].bytes)
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  const bytes = copyBytes(files[0].bytes);
  const detached = exactAsciiSha256(files[1].bytes);
  const complete = exactAsciiSha256(files[2].bytes);
  if (
    bytes.byteLength !== descriptor.authorizationByteLength ||
    rawSha256(bytes) !== descriptor.authorizationRawSha256 ||
    detached !== descriptor.identitySha256 ||
    complete !== descriptor.identitySha256
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  let parsed: unknown;
  try {
    const text = fatalDecoder.decode(bytes);
    if (!text.endsWith("\n") || text.endsWith("\n\n") || text.includes("\r")) {
      return fail("AUTHORIZATION_INVALID");
    }
    parsed = JSON.parse(text.slice(0, -1)) as unknown;
  } catch {
    return fail("AUTHORIZATION_INVALID");
  }
  if (!isPlainRecord(parsed) || !equalBytes(bytes, canonicalJsonLfBytes(parsed))) {
    return fail("AUTHORIZATION_INVALID");
  }
  if (
    domainSeparatedSha256(descriptor.identityHashDomain, parsed) !==
      descriptor.identitySha256 ||
    parsed.schemaVersion !== descriptor.schemaVersion ||
    !isPlainRecord(parsed.authorization) ||
    !isPlainRecord(parsed.policy) ||
    !isPlainRecord(parsed.window)
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  const authorization = parsed.authorization;
  const policy = parsed.policy;
  const window = parsed.window;
  if (
    authorization.authorizedBy !== "colin" ||
    authorization.decision !== "authorized" ||
    authorization.sourceMode !== SOURCE_MODE ||
    authorization.episodeId !== descriptor.episodeId ||
    authorization.expectedExportRunId !== descriptor.expectedExportRunId ||
    typeof authorization.authorizedAt !== "string" ||
    typeof authorization.authorizedAtEpochSecond !== "number" ||
    !Number.isSafeInteger(authorization.authorizedAtEpochSecond) ||
    new Date(authorization.authorizedAtEpochSecond * 1_000).toISOString() !==
      authorization.authorizedAt ||
    authorization.authorizedAtEpochSecond >= descriptor.startEpochSecond ||
    policy.schemaVersion !== PRIVATE_PILOT_TASK1_POLICY_SCHEMA_VERSION ||
    policy.policyId !== PRIVATE_PILOT_TASK1_POLICY_ID ||
    policy.sha256 !== PRIVATE_PILOT_TASK1_POLICY_SHA256 ||
    window.startEpochSecond !== descriptor.startEpochSecond ||
    window.endEpochSecond !== descriptor.endEpochSecond ||
    window.durationSeconds !== 600 ||
    window.semantics !== "inclusive" ||
    window.asOf !== descriptor.asOf
  ) {
    return fail("POLICY_MISMATCH");
  }
  return Object.freeze({
    descriptor,
    record: deepFreeze(parsed as PrivatePilotTask1CanonicalJsonObject),
    bytes,
    authorization,
    policy,
    window,
    handling: asCanonicalObject(parsed.handling, "AUTHORIZATION_INVALID"),
    structuredEvidence: asCanonicalObject(
      parsed.structuredEvidence,
      "AUTHORIZATION_INVALID",
    ),
    privacy: asCanonicalObject(parsed.privacy, "AUTHORIZATION_INVALID"),
    quality: asCanonicalObject(parsed.quality, "AUTHORIZATION_INVALID"),
    retention: validatePrivatePilotTask1RetentionV0_2(parsed.retention),
    failurePolicy: asCanonicalObject(
      parsed.failurePolicy,
      "AUTHORIZATION_INVALID",
    ),
    canonicalization: asCanonicalObject(
      parsed.canonicalization,
      "AUTHORIZATION_INVALID",
    ),
  });
}

export const PRIVATE_PILOT_TASK1_RETENTION_V0_2 = Object.freeze({
  action: "delete",
  incompleteStagingSeconds: 3_600,
  dayflowRawMaximumSeconds: 86_400,
  sealedPrivateInputMaximumSeconds: 2_592_000,
} as const);

export type PrivatePilotTask1RetentionV0_2 =
  typeof PRIVATE_PILOT_TASK1_RETENTION_V0_2;

function validatePrivatePilotTask1RetentionV0_2(
  value: unknown,
): PrivatePilotTask1RetentionV0_2 {
  const retention = asCanonicalObject(value, "AUTHORIZATION_INVALID");
  const keys = Object.keys(retention);
  if (
    keys.length !== 4 ||
    retention.action !== PRIVATE_PILOT_TASK1_RETENTION_V0_2.action ||
    retention.incompleteStagingSeconds !==
      PRIVATE_PILOT_TASK1_RETENTION_V0_2.incompleteStagingSeconds ||
    retention.dayflowRawMaximumSeconds !==
      PRIVATE_PILOT_TASK1_RETENTION_V0_2.dayflowRawMaximumSeconds ||
    retention.sealedPrivateInputMaximumSeconds !==
      PRIVATE_PILOT_TASK1_RETENTION_V0_2.sealedPrivateInputMaximumSeconds ||
    !keys.every((key) =>
      Object.prototype.hasOwnProperty.call(
        PRIVATE_PILOT_TASK1_RETENTION_V0_2,
        key,
      ),
    )
  ) {
    return fail("POLICY_MISMATCH");
  }
  return PRIVATE_PILOT_TASK1_RETENTION_V0_2;
}

function validateStructured(
  descriptor: StructuredCurrentWorkEvidenceDescriptorV1,
  asOf: string,
): Readonly<{ bytes: Uint8Array; rawSha256: string }> {
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    nodeUtilTypes.isProxy(descriptor) ||
    descriptor.schemaVersion !==
      "blabase.dayflow-ablation.structured-current-work-evidence.v1" ||
    descriptor.asOf !== asOf ||
    (descriptor.githubMode !== "configured_available" &&
      descriptor.githubMode !== "unconfigured") ||
    !SHA256_HEX.test(descriptor.sha256) ||
    !Number.isSafeInteger(descriptor.canonicalJsonByteLength) ||
    typeof descriptor.canonicalJson !== "string"
  ) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(descriptor.canonicalJson) as unknown;
    if (
      jcsCanonicalize(parsed) !== descriptor.canonicalJson ||
      domainSeparatedSha256(descriptor.schemaVersion, parsed) !==
        descriptor.sha256
    ) {
      return fail("STRUCTURED_EVIDENCE_INVALID");
    }
  } catch {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.currentWorkEvidence)) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  if (parsed.currentWorkEvidence.asOf !== asOf) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  const bytes = encoder.encode(descriptor.canonicalJson);
  if (bytes.byteLength !== descriptor.canonicalJsonByteLength) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  return Object.freeze({ bytes, rawSha256: rawSha256(bytes) });
}

function validateDayflow(
  dayflow: PrivatePilotTask1RealReaderBindingV0_2,
  authorization: ReturnType<typeof validateAuthorization>,
): Readonly<{
  descriptor: PrivatePilotTask1QualificationDescriptorV0_2;
  sources: readonly OwnedSource[];
  captureBinding: PrivatePilotTask1CanonicalJsonObject;
  wireProvenance: PrivatePilotTask1CanonicalJsonObject;
}> {
  if (
    dayflow === null ||
    typeof dayflow !== "object" ||
    nodeUtilTypes.isProxy(dayflow) ||
    dayflow.sourceDescriptor?.readSchemaVersion !==
      PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION ||
    dayflow.sourceDescriptor.sourceMode !== SOURCE_MODE ||
    dayflow.sourceDescriptor.bundleDirectoryName !==
      authorization.descriptor.expectedExportRunId ||
    !SHA256_HEX.test(dayflow.sourceDescriptor.captureBindingSha256) ||
    typeof dayflow.copySourceEntries !== "function"
  ) {
    return fail("SOURCE_MODE_MISMATCH");
  }
  if (
    !Array.isArray(dayflow.sourceDescriptor.sourceOrder) ||
    dayflow.sourceDescriptor.sourceOrder.length !== SOURCE_PATHS.length ||
    SOURCE_PATHS.some(
      (path, index) => dayflow.sourceDescriptor.sourceOrder[index] !== path,
    )
  ) {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  const captureBinding = asCanonicalObject(
    dayflow.sourceDescriptor.captureBinding,
    "DAYFLOW_SOURCE_INVALID",
  );
  const wireProvenance = asCanonicalObject(
    dayflow.sourceDescriptor.wireProvenance,
    "DAYFLOW_SOURCE_INVALID",
  );
  if (
    captureBinding.authorizationId !==
      authorization.descriptor.identitySha256 ||
    captureBinding.policySha256 !== PRIVATE_PILOT_TASK1_POLICY_SHA256 ||
    captureBinding.expectedExportRunId !==
      authorization.descriptor.expectedExportRunId ||
    !isPlainRecord(captureBinding.window) ||
    captureBinding.window.startEpochSecond !==
      authorization.descriptor.startEpochSecond ||
    captureBinding.window.endEpochSecond !==
      authorization.descriptor.endEpochSecond
  ) {
    return fail("WINDOW_MISMATCH");
  }
  const descriptor = dayflow.qualified?.descriptor;
  if (
    descriptor === undefined ||
    descriptor === null ||
    typeof descriptor !== "object" ||
    descriptor.qualificationSchemaVersion === SYNTHETIC_IMPORT_SCHEMA_VERSION ||
    !VERSION_TOKEN.test(descriptor.qualificationSchemaVersion) ||
    descriptor.exportRunId !== authorization.descriptor.expectedExportRunId ||
    !Number.isSafeInteger(descriptor.manifestByteCount) ||
    !Number.isSafeInteger(descriptor.payloadByteCount) ||
    !SHA256_HEX.test(descriptor.manifestSha256) ||
    !SHA256_HEX.test(descriptor.payloadSha256) ||
    !SHA256_HEX.test(descriptor.replayIdentitySha256) ||
    dayflow.qualified.evidence?.window?.startEpochSecond !==
      authorization.descriptor.startEpochSecond ||
    dayflow.qualified.evidence.window.endEpochSecond !==
      authorization.descriptor.endEpochSecond
  ) {
    return fail("DAYFLOW_QUALIFICATION_INVALID");
  }
  let entries: readonly PrivatePilotTask1SourceEntryV0_2[];
  try {
    entries = dayflow.copySourceEntries();
  } catch {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  if (
    !Array.isArray(entries) ||
    entries.length !== SOURCE_PATHS.length ||
    !Array.isArray(dayflow.sourceFiles) ||
    dayflow.sourceFiles.length !== SOURCE_PATHS.length
  ) {
    return fail("DAYFLOW_SOURCE_INVALID");
  }
  const sources: OwnedSource[] = [];
  for (let index = 0; index < SOURCE_PATHS.length; index += 1) {
    const path = SOURCE_PATHS[index]!;
    const entry = entries[index];
    const sourceFile = dayflow.sourceFiles[index];
    if (
      entry === undefined ||
      sourceFile === undefined ||
      entry.relativePath !== path ||
      sourceFile.relativePath !== path ||
      entry.entryKind !== "regular-file" ||
      sourceFile.entryKind !== "regular-file" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 0 ||
      entry.byteLength !== sourceFile.byteLength ||
      !isGenuineBytes(entry.bytes) ||
      entry.bytes.byteLength !== entry.byteLength
    ) {
      return fail("DAYFLOW_SOURCE_INVALID");
    }
    const bytes = copyBytes(entry.bytes);
    const hash = rawSha256(bytes);
    if (sourceFile.rawSha256 !== hash) return fail("DAYFLOW_SOURCE_INVALID");
    sources.push(Object.freeze({ relativePath: path, bytes, rawSha256: hash }));
  }
  if (
    sources[0]!.bytes.byteLength !== descriptor.payloadByteCount ||
    sources[0]!.rawSha256 !== descriptor.payloadSha256 ||
    sources[1]!.bytes.byteLength !== descriptor.manifestByteCount ||
    sources[1]!.rawSha256 !== descriptor.manifestSha256 ||
    exactAsciiSha256(sources[2]!.bytes) !== descriptor.manifestSha256 ||
    exactAsciiSha256(sources[3]!.bytes) !== descriptor.manifestSha256
  ) {
    return fail("DAYFLOW_QUALIFICATION_INVALID");
  }
  return Object.freeze({
    descriptor: deepFreeze({ ...descriptor }),
    sources: Object.freeze(sources),
    captureBinding,
    wireProvenance,
  });
}

function storedFile(
  relativePath: (typeof STORED_PATHS)[number],
  mediaType: string,
  source: Uint8Array,
): StoredFile {
  const bytes = copyBytes(source);
  return Object.freeze({
    relativePath,
    mediaType,
    bytes,
    rawSha256: rawSha256(bytes),
  });
}

function copyStoredFiles(
  files: readonly StoredFile[],
): readonly PrivateEvaluationArtifactSetFile[] {
  return Object.freeze(
    files.map((file) => {
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
  input: BuildPrivatePilotTask1EvaluationInputSealV0_2Input,
): BuiltPrivatePilotTask1EvaluationInputSealV0_2 {
  if (input === null || typeof input !== "object" || nodeUtilTypes.isProxy(input)) {
    return fail("INPUT_INVALID");
  }
  const authorization = validateAuthorization(input.authorization);
  const structured = validateStructured(
    input.structured,
    authorization.descriptor.asOf,
  );
  const dayflow = validateDayflow(input.dayflow, authorization);
  const sourceFiles = Object.freeze(
    dayflow.sources.map((source) =>
      Object.freeze({
        sourceRelativePath: source.relativePath,
        storedRelativePath: STORED_DAYFLOW_PATHS[source.relativePath],
        byteLength: source.bytes.byteLength,
        rawSha256: source.rawSha256,
      }),
    ),
  );
  const manifest = deepFreeze<PrivatePilotTask1EvaluationInputManifestV0_2>({
    schemaVersion:
      PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
    authorization: {
      schemaVersion: PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION,
      identityHashDomain: authorization.descriptor.identityHashDomain,
      identitySha256: authorization.descriptor.identitySha256,
      byteLength: authorization.bytes.byteLength,
      rawSha256: rawSha256(authorization.bytes),
      authorizedBy: "colin",
      decision: "authorized",
      authorizedAt: authorization.authorization.authorizedAt as string,
      episodeId: authorization.descriptor.episodeId,
      expectedExportRunId: authorization.descriptor.expectedExportRunId,
    },
    policy: {
      schemaVersion: PRIVATE_PILOT_TASK1_POLICY_SCHEMA_VERSION,
      policyId: PRIVATE_PILOT_TASK1_POLICY_ID,
      sha256: PRIVATE_PILOT_TASK1_POLICY_SHA256,
    },
    sourceMode: SOURCE_MODE,
    window: {
      startEpochSecond: authorization.descriptor.startEpochSecond,
      endEpochSecond: authorization.descriptor.endEpochSecond,
      durationSeconds: 600,
      semantics: "inclusive",
      asOf: authorization.descriptor.asOf,
    },
    authorizationControls: {
      handling: authorization.handling,
      structuredEvidence: authorization.structuredEvidence,
      privacy: authorization.privacy,
      quality: authorization.quality,
      retention: authorization.retention,
      failurePolicy: authorization.failurePolicy,
    },
    structured: {
      schemaVersion: input.structured.schemaVersion,
      asOf: input.structured.asOf,
      githubMode: input.structured.githubMode,
      storedRelativePath: "structured-evidence.json",
      byteLength: structured.bytes.byteLength,
      rawSha256: structured.rawSha256,
      contentSha256: input.structured.sha256,
    },
    dayflow: {
      read: {
        readSchemaVersion: PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION,
        sourceMode: SOURCE_MODE,
        bundleDirectoryName: input.dayflow.sourceDescriptor.bundleDirectoryName,
        sourceOrder: SOURCE_PATHS,
        captureBinding: dayflow.captureBinding,
        captureBindingSha256:
          input.dayflow.sourceDescriptor.captureBindingSha256,
        wireProvenance: dayflow.wireProvenance,
      },
      qualification: dayflow.descriptor,
      sourceFiles,
    },
    canonicalization: {
      authorization: authorization.canonicalization,
      storedManifest: "rfc8785-jcs.utf8.lf.v1",
      identityHashDomain:
        PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
      identityPreimage:
        "manifest-without-self-hash-or-publication-metadata",
    },
  });
  const identitySha256 = domainSeparatedSha256(
    PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
    manifest,
  );
  const manifestBytes = canonicalJsonLfBytes(manifest);
  const authorizationIdentityBytes = encoder.encode(
    authorization.descriptor.identitySha256,
  );
  const identityBytes = encoder.encode(identitySha256);
  const files = Object.freeze([
    storedFile(STORED_PATHS[0], "application/json", authorization.bytes),
    storedFile(
      STORED_PATHS[1],
      "text/plain; charset=us-ascii",
      authorizationIdentityBytes,
    ),
    storedFile(STORED_PATHS[2], "application/json", structured.bytes),
    storedFile(STORED_PATHS[3], "application/json", dayflow.sources[0]!.bytes),
    storedFile(STORED_PATHS[4], "application/json", dayflow.sources[1]!.bytes),
    storedFile(STORED_PATHS[5], "text/plain; charset=us-ascii", dayflow.sources[2]!.bytes),
    storedFile(STORED_PATHS[6], "text/plain; charset=us-ascii", dayflow.sources[3]!.bytes),
    storedFile(STORED_PATHS[7], "application/json", manifestBytes),
    storedFile(STORED_PATHS[8], "text/plain; charset=us-ascii", identityBytes),
    storedFile(STORED_PATHS[9], "text/plain; charset=us-ascii", identityBytes),
  ]);
  enforcePrivatePilotTask1ArtifactBudgetV0_2(files);
  const result = Object.freeze({
    descriptor: Object.freeze({
      manifestSchemaVersion:
        PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
      identityHashDomain:
        PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
      identitySha256,
      manifestByteLength: manifestBytes.byteLength,
      manifestRawSha256: rawSha256(manifestBytes),
      authorizationIdentitySha256: authorization.descriptor.identitySha256,
      sourceMode: SOURCE_MODE,
      startEpochSecond: authorization.descriptor.startEpochSecond,
      endEpochSecond: authorization.descriptor.endEpochSecond,
      asOf: authorization.descriptor.asOf,
    }),
    manifest,
    copyArtifactFiles: () => copyStoredFiles(files),
  });
  builtSealBrand.add(result);
  return result;
}

function enforcePrivatePilotTask1ArtifactBudgetV0_2(
  files: readonly StoredFile[],
): void {
  const seen = new Set<Task1PrivatePilotArtifactBudgetFileV0_2>();
  let aggregateBytes = 0;
  if (files.length !== 10) {
    fail("INPUT_INVALID");
  }
  for (const file of files) {
    if (
      !Object.prototype.hasOwnProperty.call(
        TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
        file.relativePath,
      )
    ) {
      fail("INPUT_INVALID");
    }
    const relativePath =
      file.relativePath as Task1PrivatePilotArtifactBudgetFileV0_2;
    if (seen.has(relativePath)) {
      fail("INPUT_INVALID");
    }
    seen.add(relativePath);
    const maximumBytes =
      TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[relativePath];
    if (file.bytes.byteLength > maximumBytes) {
      fail("INPUT_INVALID");
    }
    aggregateBytes += file.bytes.byteLength;
  }
  if (
    seen.size !== 10 ||
    !Number.isSafeInteger(aggregateBytes) ||
    aggregateBytes > TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2
  ) {
    fail("INPUT_INVALID");
  }
}

export function buildPrivatePilotTask1EvaluationInputSealV0_2(
  input: BuildPrivatePilotTask1EvaluationInputSealV0_2Input,
): BuiltPrivatePilotTask1EvaluationInputSealV0_2 {
  try {
    return buildInternal(input);
  } catch (error) {
    if (error instanceof PrivatePilotTask1EvaluationInputSealErrorV0_2) {
      throw error;
    }
    return fail("INPUT_INVALID");
  }
}

function pathComponents(
  seal: BuiltPrivatePilotTask1EvaluationInputSealV0_2,
): readonly string[] {
  if (!builtSealBrand.has(seal)) return fail("INPUT_INVALID");
  return Object.freeze([
    ".local",
    "dayflow-ablation",
    "inputs",
    PRIVATE_PILOT_TASK1_POLICY_ID,
    "runs",
    seal.descriptor.identitySha256,
  ]);
}

function freezeVerified(
  value: VerifiedPrivateEvaluationArtifactSet,
): VerifiedPrivateEvaluationArtifactSet {
  return Object.freeze({
    relativeDirectory: value.relativeDirectory,
    directoryMode: value.directoryMode,
    files: Object.freeze(value.files.map((file) => Object.freeze({ ...file }))),
  });
}

export async function publishPrivatePilotTask1EvaluationInputSealV0_2(
  input: Readonly<{
    dataRoot: string;
    seal: BuiltPrivatePilotTask1EvaluationInputSealV0_2;
  }>,
): Promise<VerifiedPrivateEvaluationArtifactSet> {
  try {
    return freezeVerified(
      await publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: input.dataRoot,
        pathComponents: pathComponents(input.seal),
        files: input.seal.copyArtifactFiles(),
      }),
    );
  } catch (error) {
    if (
      error instanceof PrivatePilotTask1EvaluationInputSealErrorV0_2 &&
      error.issueCode === "INPUT_INVALID"
    ) {
      throw error;
    }
    return fail("PUBLICATION_FAILED");
  }
}

export async function verifyPublishedPrivatePilotTask1EvaluationInputSealV0_2(
  input: Readonly<{
    dataRoot: string;
    seal: BuiltPrivatePilotTask1EvaluationInputSealV0_2;
  }>,
): Promise<VerifiedPrivateEvaluationArtifactSet> {
  try {
    return freezeVerified(
      await verifyPrivateEvaluationArtifactSetReadback({
        dataRoot: input.dataRoot,
        pathComponents: pathComponents(input.seal),
        expectedFiles: input.seal.copyArtifactFiles(),
      }),
    );
  } catch (error) {
    if (
      error instanceof PrivatePilotTask1EvaluationInputSealErrorV0_2 &&
      error.issueCode === "INPUT_INVALID"
    ) {
      throw error;
    }
    return fail("VERIFICATION_FAILED");
  }
}
import {
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
  type Task1PrivatePilotArtifactBudgetFileV0_2,
} from "./task1PrivatePilotArtifactBudgetV0_2";
