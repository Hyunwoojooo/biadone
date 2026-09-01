import { types as nodeUtilTypes } from "node:util";

import { domainSeparatedSha256 } from "../../dayflowEvidence/contracts";
import {
  canonicalJsonLfBytes,
  rawSha256,
  readPrivateEvaluationArtifactSetExact,
} from "../privateArtifactStore";
import {
  TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
  TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
} from "./task1PrivatePilotAuthorizationV1";
import {
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
} from "./task1PrivatePilotArtifactBudgetV0_2";
import {
  PRIVATE_PILOT_TASK1_RETENTION_V0_2,
  type PrivatePilotTask1RetentionV0_2,
} from "./sealPrivatePilotTask1EvaluationInputV0_2";

const MANIFEST_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1-evaluation-input-manifest.v0.2" as const;
const IDENTITY_HASH_DOMAIN =
  "blabase.dayflow-ablation.task1-evaluation-input.v0.2" as const;
const POLICY_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1c-policy.v0.1" as const;
const POLICY_ID = "dayflow-ablation-private-pilot-v0.1" as const;
const POLICY_SHA256 =
  "da6ff5f6a9c4a5f62b04e81fdee6acf65d251689b1a96c93d2b0fd8b1e0a5ff2" as const;
const SOURCE_MODE = "real-private-pilot" as const;
const REAL_READ_SCHEMA_VERSION =
  "blabase.dayflow-metadata-evidence-private-pilot-read.v1" as const;
const QUALIFICATION_SCHEMA_VERSION =
  "blabase.dayflow-ablation.metadata-evidence-bundle-qualification.v1" as const;
const STRUCTURED_SCHEMA_VERSION =
  "blabase.dayflow-ablation.structured-current-work-evidence.v1" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

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

const FILE_SPECS = Object.freeze([
  Object.freeze({
    relativePath: STORED_PATHS[0],
    mediaType: "application/json",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[0]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[1],
    mediaType: "text/plain",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[1]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[2],
    mediaType: "application/json",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[2]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[3],
    mediaType: "application/json",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[3]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[4],
    mediaType: "application/json",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[4]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[5],
    mediaType: "text/plain",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[5]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[6],
    mediaType: "text/plain",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[6]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[7],
    mediaType: "application/json",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[7]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[8],
    mediaType: "text/plain",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[8]],
  }),
  Object.freeze({
    relativePath: STORED_PATHS[9],
    mediaType: "text/plain",
    maxBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[STORED_PATHS[9]],
  }),
] as const);

const FILE_SPECS_TOTAL_BYTES = FILE_SPECS.reduce(
  (total, spec) => total + spec.maxBytes,
  0,
);

if (
  FILE_SPECS_TOTAL_BYTES !==
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2
) {
  throw new Error("TASK1_PRIVATE_PILOT_IDENTITY_VERIFIER_BUDGET_INVALID");
}

export type VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2 =
  | "INPUT_INVALID"
  | "PATH_MISMATCH"
  | "ARTIFACT_SET_INVALID"
  | "CANONICAL_JSON_INVALID"
  | "MANIFEST_INVALID"
  | "IDENTITY_MISMATCH"
  | "AUTHORIZATION_INVALID"
  | "STRUCTURED_INVALID"
  | "DAYFLOW_INVALID"
  | "RETENTION_INVALID";

export class VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityErrorV0_2 extends Error {
  readonly issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2;

  constructor(
    issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
  ) {
    super(issueCode);
    this.name =
      "VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityErrorV0_2";
    this.issueCode = issueCode;
    Object.freeze(this);
  }
}

export type VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2Input =
  Readonly<{
    dataRoot: string;
    relativeDirectory: string;
    expectedIdentitySha256: string;
  }>;

export type VerifiedPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2 =
  Readonly<{
    manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
    identityHashDomain: typeof IDENTITY_HASH_DOMAIN;
    identitySha256: string;
    manifestByteLength: number;
    manifestRawSha256: string;
    authorizationIdentitySha256: string;
    sourceMode: typeof SOURCE_MODE;
    startEpochSecond: number;
    endEpochSecond: number;
    asOf: string;
    githubMode: "configured_available" | "unconfigured";
    retention: PrivatePilotTask1RetentionV0_2;
  }>;

function fail(
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): never {
  throw new VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityErrorV0_2(
    issueCode,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !nodeUtilTypes.isProxy(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function record(
  value: unknown,
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return fail(issueCode);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    !actual.every((key) => keys.includes(key))
  ) {
    fail(issueCode);
  }
}

function stringValue(
  value: unknown,
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): string {
  if (typeof value !== "string") {
    return fail(issueCode);
  }
  return value;
}

function safeInteger(
  value: unknown,
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return fail(issueCode);
  }
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function parseCanonicalJsonLf(
  bytes: Uint8Array,
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): Record<string, unknown> {
  if (bytes.byteLength < 3 || bytes[bytes.byteLength - 1] !== 0x0a) {
    return fail(issueCode);
  }
  let decoded: string;
  try {
    decoded = UTF8_FATAL.decode(bytes);
  } catch {
    return fail(issueCode);
  }
  if (decoded.charCodeAt(0) === 0xfeff || !decoded.endsWith("\n")) {
    return fail(issueCode);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.slice(0, -1));
  } catch {
    return fail(issueCode);
  }
  const parsedRecord = record(parsed, issueCode);
  if (!bytesEqual(canonicalJsonLfBytes(parsedRecord), bytes)) {
    return fail("CANONICAL_JSON_INVALID");
  }
  return parsedRecord;
}

function parseCanonicalJsonNoLf(
  bytes: Uint8Array,
  issueCode: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityIssueCodeV0_2,
): Record<string, unknown> {
  if (bytes.byteLength === 0 || bytes[bytes.byteLength - 1] === 0x0a) {
    return fail(issueCode);
  }
  let decoded: string;
  try {
    decoded = UTF8_FATAL.decode(bytes);
  } catch {
    return fail(issueCode);
  }
  if (decoded.charCodeAt(0) === 0xfeff) {
    return fail(issueCode);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return fail(issueCode);
  }
  const parsedRecord = record(parsed, issueCode);
  const canonicalLf = canonicalJsonLfBytes(parsedRecord);
  if (
    canonicalLf.byteLength !== bytes.byteLength + 1 ||
    canonicalLf[canonicalLf.byteLength - 1] !== 0x0a ||
    !bytesEqual(canonicalLf.subarray(0, -1), bytes)
  ) {
    return fail("CANONICAL_JSON_INVALID");
  }
  return parsedRecord;
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  try {
    return bytesEqual(canonicalJsonLfBytes(left), canonicalJsonLfBytes(right));
  } catch {
    return false;
  }
}

function marker(bytes: Uint8Array): string {
  if (bytes.byteLength !== 64) {
    return fail("IDENTITY_MISMATCH");
  }
  let value: string;
  try {
    value = UTF8_FATAL.decode(bytes);
  } catch {
    return fail("IDENTITY_MISMATCH");
  }
  if (!SHA256_HEX.test(value)) {
    return fail("IDENTITY_MISMATCH");
  }
  return value;
}

function validateRetention(value: unknown): PrivatePilotTask1RetentionV0_2 {
  const retention = record(value, "RETENTION_INVALID");
  exactKeys(
    retention,
    [
      "action",
      "incompleteStagingSeconds",
      "dayflowRawMaximumSeconds",
      "sealedPrivateInputMaximumSeconds",
    ],
    "RETENTION_INVALID",
  );
  if (
    retention.action !== PRIVATE_PILOT_TASK1_RETENTION_V0_2.action ||
    retention.incompleteStagingSeconds !==
      PRIVATE_PILOT_TASK1_RETENTION_V0_2.incompleteStagingSeconds ||
    retention.dayflowRawMaximumSeconds !==
      PRIVATE_PILOT_TASK1_RETENTION_V0_2.dayflowRawMaximumSeconds ||
    retention.sealedPrivateInputMaximumSeconds !==
      PRIVATE_PILOT_TASK1_RETENTION_V0_2.sealedPrivateInputMaximumSeconds
  ) {
    return fail("RETENTION_INVALID");
  }
  return PRIVATE_PILOT_TASK1_RETENTION_V0_2;
}

function validateManifest(
  manifest: Record<string, unknown>,
  expectedIdentitySha256: string,
): Readonly<{
  authorizationIdentitySha256: string;
  startEpochSecond: number;
  endEpochSecond: number;
  asOf: string;
  githubMode: "configured_available" | "unconfigured";
  retention: PrivatePilotTask1RetentionV0_2;
  authorization: Record<string, unknown>;
  structured: Record<string, unknown>;
  dayflow: Record<string, unknown>;
  authorizationControls: Record<string, unknown>;
  canonicalization: Record<string, unknown>;
}> {
  exactKeys(
    manifest,
    [
      "schemaVersion",
      "authorization",
      "policy",
      "sourceMode",
      "window",
      "authorizationControls",
      "structured",
      "dayflow",
      "canonicalization",
    ],
    "MANIFEST_INVALID",
  );
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    manifest.sourceMode !== SOURCE_MODE ||
    domainSeparatedSha256(IDENTITY_HASH_DOMAIN, manifest) !==
      expectedIdentitySha256
  ) {
    return fail("IDENTITY_MISMATCH");
  }

  const policy = record(manifest.policy, "MANIFEST_INVALID");
  exactKeys(policy, ["schemaVersion", "policyId", "sha256"], "MANIFEST_INVALID");
  if (
    policy.schemaVersion !== POLICY_SCHEMA_VERSION ||
    policy.policyId !== POLICY_ID ||
    policy.sha256 !== POLICY_SHA256
  ) {
    return fail("MANIFEST_INVALID");
  }

  const window = record(manifest.window, "MANIFEST_INVALID");
  exactKeys(
    window,
    [
      "startEpochSecond",
      "endEpochSecond",
      "durationSeconds",
      "semantics",
      "asOf",
    ],
    "MANIFEST_INVALID",
  );
  const startEpochSecond = safeInteger(
    window.startEpochSecond,
    "MANIFEST_INVALID",
  );
  const endEpochSecond = safeInteger(window.endEpochSecond, "MANIFEST_INVALID");
  const asOf = stringValue(window.asOf, "MANIFEST_INVALID");
  if (
    startEpochSecond < 0 ||
    endEpochSecond - startEpochSecond !== 599 ||
    window.durationSeconds !== 600 ||
    window.semantics !== "inclusive" ||
    new Date(endEpochSecond * 1_000).toISOString() !== asOf
  ) {
    return fail("MANIFEST_INVALID");
  }

  const authorization = record(manifest.authorization, "MANIFEST_INVALID");
  exactKeys(
    authorization,
    [
      "schemaVersion",
      "identityHashDomain",
      "identitySha256",
      "byteLength",
      "rawSha256",
      "authorizedBy",
      "decision",
      "authorizedAt",
      "episodeId",
      "expectedExportRunId",
    ],
    "MANIFEST_INVALID",
  );
  const authorizationIdentitySha256 = stringValue(
    authorization.identitySha256,
    "MANIFEST_INVALID",
  );
  if (
    authorization.schemaVersion !==
      TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION ||
    authorization.identityHashDomain !==
      TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN ||
    !SHA256_HEX.test(authorizationIdentitySha256) ||
    authorization.authorizedBy !== "colin" ||
    authorization.decision !== "authorized" ||
    typeof authorization.episodeId !== "string" ||
    authorization.episodeId.length === 0 ||
    typeof authorization.expectedExportRunId !== "string" ||
    authorization.expectedExportRunId.length === 0
  ) {
    return fail("MANIFEST_INVALID");
  }

  const controls = record(
    manifest.authorizationControls,
    "MANIFEST_INVALID",
  );
  exactKeys(
    controls,
    [
      "handling",
      "structuredEvidence",
      "privacy",
      "quality",
      "retention",
      "failurePolicy",
    ],
    "MANIFEST_INVALID",
  );
  const retention = validateRetention(controls.retention);

  const structured = record(manifest.structured, "STRUCTURED_INVALID");
  exactKeys(
    structured,
    [
      "schemaVersion",
      "asOf",
      "githubMode",
      "storedRelativePath",
      "byteLength",
      "rawSha256",
      "contentSha256",
    ],
    "STRUCTURED_INVALID",
  );
  const githubMode = structured.githubMode;
  if (
    structured.schemaVersion !== STRUCTURED_SCHEMA_VERSION ||
    structured.asOf !== asOf ||
    (githubMode !== "configured_available" && githubMode !== "unconfigured") ||
    structured.storedRelativePath !== STORED_PATHS[2] ||
    !SHA256_HEX.test(stringValue(structured.rawSha256, "STRUCTURED_INVALID")) ||
    !SHA256_HEX.test(
      stringValue(structured.contentSha256, "STRUCTURED_INVALID"),
    )
  ) {
    return fail("STRUCTURED_INVALID");
  }

  const dayflow = record(manifest.dayflow, "DAYFLOW_INVALID");
  exactKeys(dayflow, ["read", "qualification", "sourceFiles"], "DAYFLOW_INVALID");
  const canonicalization = record(
    manifest.canonicalization,
    "MANIFEST_INVALID",
  );
  exactKeys(
    canonicalization,
    [
      "authorization",
      "storedManifest",
      "identityHashDomain",
      "identityPreimage",
    ],
    "MANIFEST_INVALID",
  );
  if (
    canonicalization.storedManifest !== "rfc8785-jcs.utf8.lf.v1" ||
    canonicalization.identityHashDomain !== IDENTITY_HASH_DOMAIN ||
    canonicalization.identityPreimage !==
      "manifest-without-self-hash-or-publication-metadata"
  ) {
    return fail("MANIFEST_INVALID");
  }

  return Object.freeze({
    authorizationIdentitySha256,
    startEpochSecond,
    endEpochSecond,
    asOf,
    githubMode,
    retention,
    authorization,
    structured,
    dayflow,
    authorizationControls: controls,
    canonicalization,
  });
}

function validateAuthorization(
  bytes: Uint8Array,
  markerBytes: Uint8Array,
  manifestBinding: ReturnType<typeof validateManifest>,
): Record<string, unknown> {
  const expected = manifestBinding.authorization;
  if (
    safeInteger(expected.byteLength, "AUTHORIZATION_INVALID") !==
      bytes.byteLength ||
    stringValue(expected.rawSha256, "AUTHORIZATION_INVALID") !==
      rawSha256(bytes)
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  const authorizationRecord = parseCanonicalJsonLf(
    bytes,
    "AUTHORIZATION_INVALID",
  );
  if (
    marker(markerBytes) !== manifestBinding.authorizationIdentitySha256 ||
    domainSeparatedSha256(
      TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
      authorizationRecord,
    ) !== manifestBinding.authorizationIdentitySha256 ||
    authorizationRecord.schemaVersion !==
      TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION
  ) {
    return fail("AUTHORIZATION_INVALID");
  }

  const authorization = record(
    authorizationRecord.authorization,
    "AUTHORIZATION_INVALID",
  );
  const policy = record(authorizationRecord.policy, "AUTHORIZATION_INVALID");
  const window = record(authorizationRecord.window, "AUTHORIZATION_INVALID");
  if (
    authorization.authorizedBy !== "colin" ||
    authorization.decision !== "authorized" ||
    authorization.sourceMode !== SOURCE_MODE ||
    authorization.episodeId !== expected.episodeId ||
    authorization.expectedExportRunId !== expected.expectedExportRunId ||
    authorization.authorizedAt !== expected.authorizedAt ||
    policy.schemaVersion !== POLICY_SCHEMA_VERSION ||
    policy.policyId !== POLICY_ID ||
    policy.sha256 !== POLICY_SHA256 ||
    window.startEpochSecond !== manifestBinding.startEpochSecond ||
    window.endEpochSecond !== manifestBinding.endEpochSecond ||
    window.durationSeconds !== 600 ||
    window.semantics !== "inclusive" ||
    window.asOf !== manifestBinding.asOf ||
    !canonicalValuesEqual(
      authorizationRecord.handling,
      manifestBinding.authorizationControls.handling,
    ) ||
    !canonicalValuesEqual(
      authorizationRecord.structuredEvidence,
      manifestBinding.authorizationControls.structuredEvidence,
    ) ||
    !canonicalValuesEqual(
      authorizationRecord.privacy,
      manifestBinding.authorizationControls.privacy,
    ) ||
    !canonicalValuesEqual(
      authorizationRecord.quality,
      manifestBinding.authorizationControls.quality,
    ) ||
    !canonicalValuesEqual(
      authorizationRecord.failurePolicy,
      manifestBinding.authorizationControls.failurePolicy,
    ) ||
    !canonicalValuesEqual(
      authorizationRecord.canonicalization,
      manifestBinding.canonicalization.authorization,
    )
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  validateRetention(authorizationRecord.retention);
  return authorizationRecord;
}

function validateStructured(
  bytes: Uint8Array,
  manifestBinding: ReturnType<typeof validateManifest>,
): void {
  const expected = manifestBinding.structured;
  if (
    safeInteger(expected.byteLength, "STRUCTURED_INVALID") !== bytes.byteLength ||
    expected.rawSha256 !== rawSha256(bytes)
  ) {
    fail("STRUCTURED_INVALID");
  }
  const structured = parseCanonicalJsonNoLf(bytes, "STRUCTURED_INVALID");
  if (
    structured.schemaVersion !== STRUCTURED_SCHEMA_VERSION ||
    domainSeparatedSha256(STRUCTURED_SCHEMA_VERSION, structured) !==
      expected.contentSha256
  ) {
    fail("STRUCTURED_INVALID");
  }
}

function validateDayflow(
  files: readonly Readonly<{
    relativePath: string;
    byteLength: number;
    rawSha256: string;
    bytes: Uint8Array;
  }>[],
  manifestBinding: ReturnType<typeof validateManifest>,
): void {
  const dayflowRead = record(manifestBinding.dayflow.read, "DAYFLOW_INVALID");
  const qualification = record(
    manifestBinding.dayflow.qualification,
    "DAYFLOW_INVALID",
  );
  const sourceFiles = manifestBinding.dayflow.sourceFiles;
  if (!Array.isArray(sourceFiles) || sourceFiles.length !== 4) {
    fail("DAYFLOW_INVALID");
  }
  if (
    dayflowRead.readSchemaVersion !== REAL_READ_SCHEMA_VERSION ||
    dayflowRead.sourceMode !== SOURCE_MODE ||
    !Array.isArray(dayflowRead.sourceOrder) ||
    !canonicalValuesEqual(dayflowRead.sourceOrder, SOURCE_PATHS) ||
    qualification.qualificationSchemaVersion !== QUALIFICATION_SCHEMA_VERSION ||
    !SHA256_HEX.test(
      stringValue(qualification.replayIdentitySha256, "DAYFLOW_INVALID"),
    )
  ) {
    fail("DAYFLOW_INVALID");
  }
  const captureBinding = record(
    dayflowRead.captureBinding,
    "DAYFLOW_INVALID",
  );
  const wireProvenance = record(
    dayflowRead.wireProvenance,
    "DAYFLOW_INVALID",
  );
  const captureWindow = record(captureBinding.window, "DAYFLOW_INVALID");
  if (
    captureBinding.authorizationId !==
      manifestBinding.authorizationIdentitySha256 ||
    captureBinding.policySha256 !== POLICY_SHA256 ||
    captureBinding.expectedExportRunId !==
      manifestBinding.authorization.expectedExportRunId ||
    captureWindow.startEpochSecond !== manifestBinding.startEpochSecond ||
    captureWindow.endEpochSecond !== manifestBinding.endEpochSecond ||
    wireProvenance.qualificationSchemaVersion !== QUALIFICATION_SCHEMA_VERSION ||
    wireProvenance.exportRunId !== qualification.exportRunId ||
    wireProvenance.manifestSha256 !== qualification.manifestSha256 ||
    wireProvenance.payloadSha256 !== qualification.payloadSha256 ||
    wireProvenance.replayIdentitySha256 !==
      qualification.replayIdentitySha256
  ) {
    fail("DAYFLOW_INVALID");
  }

  const mappings = [
    [SOURCE_PATHS[0], STORED_PATHS[3], 3],
    [SOURCE_PATHS[1], STORED_PATHS[4], 4],
    [SOURCE_PATHS[2], STORED_PATHS[5], 5],
    [SOURCE_PATHS[3], STORED_PATHS[6], 6],
  ] as const;
  for (let index = 0; index < mappings.length; index += 1) {
    const mapping = record(sourceFiles[index], "DAYFLOW_INVALID");
    const [sourceRelativePath, storedRelativePath, fileIndex] = mappings[index]!;
    const file = files[fileIndex]!;
    if (
      mapping.sourceRelativePath !== sourceRelativePath ||
      mapping.storedRelativePath !== storedRelativePath ||
      mapping.byteLength !== file.byteLength ||
      mapping.rawSha256 !== file.rawSha256
    ) {
      fail("DAYFLOW_INVALID");
    }
  }

  const payload = files[3]!;
  const sourceManifest = files[4]!;
  const sourceManifestIdentity = stringValue(
    qualification.manifestSha256,
    "DAYFLOW_INVALID",
  );
  if (
    qualification.payloadByteCount !== payload.byteLength ||
    qualification.payloadSha256 !== payload.rawSha256 ||
    qualification.manifestByteCount !== sourceManifest.byteLength ||
    sourceManifestIdentity !== sourceManifest.rawSha256 ||
    marker(files[5]!.bytes) !== sourceManifestIdentity ||
    marker(files[6]!.bytes) !== sourceManifestIdentity
  ) {
    fail("DAYFLOW_INVALID");
  }
}

export async function verifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2(
  input: VerifyPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2Input,
): Promise<VerifiedPublishedPrivatePilotTask1EvaluationInputByIdentityV0_2> {
  if (!isPlainRecord(input)) {
    return fail("INPUT_INVALID");
  }
  exactKeys(
    input,
    ["dataRoot", "relativeDirectory", "expectedIdentitySha256"],
    "INPUT_INVALID",
  );
  if (
    typeof input.dataRoot !== "string" ||
    input.dataRoot.length === 0 ||
    typeof input.relativeDirectory !== "string" ||
    !SHA256_HEX.test(input.expectedIdentitySha256)
  ) {
    return fail("INPUT_INVALID");
  }
  const pathComponents = Object.freeze([
    ".local",
    "dayflow-ablation",
    "inputs",
    POLICY_ID,
    "runs",
    input.expectedIdentitySha256,
  ] as const);
  const canonicalRelativeDirectory = pathComponents.join("/");
  if (input.relativeDirectory !== canonicalRelativeDirectory) {
    return fail("PATH_MISMATCH");
  }

  let readResult: Awaited<
    ReturnType<typeof readPrivateEvaluationArtifactSetExact>
  >;
  try {
    readResult = await readPrivateEvaluationArtifactSetExact({
      dataRoot: input.dataRoot,
      pathComponents,
      fileSpecs: FILE_SPECS,
    });
  } catch {
    return fail("ARTIFACT_SET_INVALID");
  }
  if (
    readResult.relativeDirectory !== canonicalRelativeDirectory ||
    readResult.files.length !== STORED_PATHS.length
  ) {
    return fail("ARTIFACT_SET_INVALID");
  }
  const files = readResult.files.map((file, index) => {
    if (
      file.relativePath !== STORED_PATHS[index] ||
      file.byteLength !== file.bytes.byteLength ||
      file.rawSha256 !== rawSha256(file.bytes)
    ) {
      return fail("ARTIFACT_SET_INVALID");
    }
    return Object.freeze({
      relativePath: file.relativePath,
      byteLength: file.byteLength,
      rawSha256: file.rawSha256,
      bytes: new Uint8Array(file.bytes),
    });
  });

  const manifestBytes = files[7]!.bytes;
  const manifest = parseCanonicalJsonLf(manifestBytes, "MANIFEST_INVALID");
  const manifestBinding = validateManifest(
    manifest,
    input.expectedIdentitySha256,
  );
  if (
    marker(files[8]!.bytes) !== input.expectedIdentitySha256 ||
    marker(files[9]!.bytes) !== input.expectedIdentitySha256
  ) {
    return fail("IDENTITY_MISMATCH");
  }
  validateAuthorization(files[0]!.bytes, files[1]!.bytes, manifestBinding);
  validateStructured(files[2]!.bytes, manifestBinding);
  validateDayflow(files, manifestBinding);

  return Object.freeze({
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    identityHashDomain: IDENTITY_HASH_DOMAIN,
    identitySha256: input.expectedIdentitySha256,
    manifestByteLength: manifestBytes.byteLength,
    manifestRawSha256: rawSha256(manifestBytes),
    authorizationIdentitySha256:
      manifestBinding.authorizationIdentitySha256,
    sourceMode: SOURCE_MODE,
    startEpochSecond: manifestBinding.startEpochSecond,
    endEpochSecond: manifestBinding.endEpochSecond,
    asOf: manifestBinding.asOf,
    githubMode: manifestBinding.githubMode,
    retention: manifestBinding.retention,
  });
}
