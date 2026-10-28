import { types as nodeUtilTypes } from "node:util";

import { domainSeparatedSha256 } from "../../dayflowEvidence/contracts";
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

export const TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1-private-pilot-authorization.v0.1" as const;
export const TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN =
  TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION;
export const TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION =
  "blabase.dayflow-ablation.task1c-policy.v0.1" as const;
export const TASK1_PRIVATE_PILOT_POLICY_ID =
  "dayflow-ablation-private-pilot-v0.1" as const;
export const TASK1_PRIVATE_PILOT_POLICY_SHA256 =
  "da6ff5f6a9c4a5f62b04e81fdee6acf65d251689b1a96c93d2b0fd8b1e0a5ff2" as const;
export const TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER = Object.freeze([
  "authorization.json",
  "authorization.sha256",
  "COMPLETE",
] as const);

const AUTHORIZATION_DURATION_SECONDS = 600 as const;
const AUTHORIZATION_END_OFFSET_SECONDS = 599 as const;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const EPISODE_ID = /^episode_[a-f0-9]{32}$/u;
const encoder = new TextEncoder();
const builtAuthorizationBrand = new WeakSet<object>();

export type Task1PrivatePilotAuthorizationIssueCodeV1 =
  | "INPUT_INVALID"
  | "AUTHORIZATION_INVALID"
  | "POLICY_INVALID"
  | "WINDOW_INVALID"
  | "PUBLICATION_FAILED"
  | "VERIFICATION_FAILED";

export class Task1PrivatePilotAuthorizationErrorV1 extends Error {
  readonly issueCode: Task1PrivatePilotAuthorizationIssueCodeV1;

  constructor(issueCode: Task1PrivatePilotAuthorizationIssueCodeV1) {
    super(`Task 1 private pilot authorization failed (${issueCode})`);
    this.name = "Task1PrivatePilotAuthorizationErrorV1";
    this.issueCode = issueCode;
  }
}

export type BuildTask1PrivatePilotAuthorizationV1Input = Readonly<{
  schemaVersion: typeof TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION;
  authorizedBy: "colin";
  decision: "authorized";
  sourceMode: "real-private-pilot";
  episodeId: string;
  workspaceIdentitySha256: string;
  authorizedAtEpochSecond: number;
  startEpochSecond: number;
  policy: Readonly<{
    schemaVersion: typeof TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION;
    policyId: typeof TASK1_PRIVATE_PILOT_POLICY_ID;
    sha256: typeof TASK1_PRIVATE_PILOT_POLICY_SHA256;
  }>;
}>;

export type Task1PrivatePilotAuthorizationManifestV1 = Readonly<{
  schemaVersion: typeof TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION;
  authorization: Readonly<{
    authorizedBy: "colin";
    decision: "authorized";
    sourceMode: "real-private-pilot";
    episodeId: string;
    workspaceIdentitySha256: string;
    authorizedAtEpochSecond: number;
    authorizedAt: string;
    expectedExportRunId: string;
  }>;
  policy: Readonly<{
    schemaVersion: typeof TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION;
    policyId: typeof TASK1_PRIVATE_PILOT_POLICY_ID;
    sha256: typeof TASK1_PRIVATE_PILOT_POLICY_SHA256;
  }>;
  window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
    durationSeconds: 600;
    semantics: "inclusive";
    asOf: string;
  }>;
  handling: Readonly<{
    purpose: "private-plumbing-evaluation-only";
    storageMode: "local-only";
    outputProfile: "metadata-only.v1";
    screenshotBytesExported: false;
    screenshotPathsExported: false;
    ocrOrObservationTextExported: false;
    suggestionFieldsAllowed: false;
    rawCopyIntoBlabaseAllowed: false;
    cloudSyncAllowed: false;
    providerUploadAllowed: false;
    gitAllowed: false;
    legacyCaptureAllowed: false;
    manualRepairAllowed: false;
  }>;
  structuredEvidence: Readonly<{
    authority: "preserved-current-work-evidence";
    snapshotAt: "inclusive-window-end";
    managedCodexRequired: true;
    githubIfUnconfigured: "null";
    githubIfConfiguredReadFails: "reject-entire-window";
    githubAsOfMustEqualSnapshotAsOf: true;
  }>;
  privacy: Readonly<{
    consentBasis: "colin-explicit-private-development-evaluation";
    dataSubjectScope: "colin-only";
    manualScreenshotInspectionAllowed: false;
    uncertainPrivacyState: "reject-entire-window";
    denylist: readonly [
      "password-manager",
      "login-or-two-factor-authentication",
      "banking-or-payment",
      "email-messenger-or-direct-message",
      "token-secret-or-env-visible-terminal",
      "production-admin-or-real-user-data",
    ];
  }>;
  quality: Readonly<{
    rejectIssueCodes: readonly [
      "NO_SCREENSHOT_METADATA_IN_WINDOW",
      "CAPTURE_GAP_DETECTED",
      "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
      "DATABASE_SCHEMA_USER_VERSION_UNSET",
    ];
    allowWarningIssueCodes: readonly [
      "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
      "OPTIONAL_SOURCE_METADATA_MISSING",
    ];
  }>;
  retention: Readonly<{
    incompleteStagingSeconds: 3600;
    dayflowRawMaximumSeconds: 86400;
    sealedPrivateInputMaximumSeconds: 2592000;
    expirationAction: "delete";
  }>;
  failurePolicy: Readonly<{
    privacyViolationOrUncertainty: "reject-entire-window";
    sourceOrQualificationFailure: "reject-entire-window";
    manualPostHocCorrectionAllowed: false;
    retryRule: "collect-new-episode";
  }>;
  canonicalization: Readonly<{
    storedAuthorization: "rfc8785-jcs.utf8.lf.v1";
    identityHashDomain: typeof TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN;
    identityPreimage: "authorization-without-self-hash-or-publication-metadata";
  }>;
}>;

export type BuiltTask1PrivatePilotAuthorizationV1 = Readonly<{
  descriptor: Readonly<{
    schemaVersion: typeof TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION;
    identityHashDomain: typeof TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN;
    identitySha256: string;
    authorizationByteLength: number;
    authorizationRawSha256: string;
    episodeId: string;
    sourceMode: "real-private-pilot";
    expectedExportRunId: string;
    startEpochSecond: number;
    endEpochSecond: number;
    asOf: string;
  }>;
  authorization: Task1PrivatePilotAuthorizationManifestV1;
  copyArtifactFiles: () => readonly PrivateEvaluationArtifactSetFile[];
}>;

type StoredAuthorizationFile = Readonly<{
  relativePath: (typeof TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER)[number];
  mediaType: string;
  byteLength: number;
  rawSha256: string;
  bytes: Uint8Array;
}>;

function fail(issueCode: Task1PrivatePilotAuthorizationIssueCodeV1): never {
  throw new Task1PrivatePilotAuthorizationErrorV1(issueCode);
}

function exactDataRecord(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  ) {
    return null;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Reflect.ownKeys(descriptors);
    const expected = new Set(expectedKeys);
    if (
      keys.length !== expected.size ||
      keys.some((key) => typeof key !== "string" || !expected.has(key))
    ) {
      return null;
    }
    const values: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function safeEpochSecondIso(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const milliseconds = value * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function validateInput(
  candidate: unknown,
): BuildTask1PrivatePilotAuthorizationV1Input {
  const input = exactDataRecord(candidate, [
    "schemaVersion",
    "authorizedBy",
    "decision",
    "sourceMode",
    "episodeId",
    "workspaceIdentitySha256",
    "authorizedAtEpochSecond",
    "startEpochSecond",
    "policy",
  ]);
  if (input === null) return fail("INPUT_INVALID");
  if (
    input.schemaVersion !== TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION ||
    input.authorizedBy !== "colin" ||
    input.decision !== "authorized" ||
    input.sourceMode !== "real-private-pilot" ||
    typeof input.episodeId !== "string" ||
    !EPISODE_ID.test(input.episodeId) ||
    typeof input.workspaceIdentitySha256 !== "string" ||
    !SHA256_HEX.test(input.workspaceIdentitySha256)
  ) {
    return fail("AUTHORIZATION_INVALID");
  }
  const policy = exactDataRecord(input.policy, [
    "schemaVersion",
    "policyId",
    "sha256",
  ]);
  if (
    policy === null ||
    policy.schemaVersion !== TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION ||
    policy.policyId !== TASK1_PRIVATE_PILOT_POLICY_ID ||
    policy.sha256 !== TASK1_PRIVATE_PILOT_POLICY_SHA256
  ) {
    return fail("POLICY_INVALID");
  }
  if (
    typeof input.authorizedAtEpochSecond !== "number" ||
    typeof input.startEpochSecond !== "number" ||
    safeEpochSecondIso(input.authorizedAtEpochSecond) === null ||
    safeEpochSecondIso(input.startEpochSecond) === null ||
    input.startEpochSecond <= input.authorizedAtEpochSecond
  ) {
    return fail("WINDOW_INVALID");
  }
  const endEpochSecond = input.startEpochSecond + AUTHORIZATION_END_OFFSET_SECONDS;
  if (safeEpochSecondIso(endEpochSecond) === null) {
    return fail("WINDOW_INVALID");
  }
  return {
    schemaVersion: TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
    authorizedBy: "colin",
    decision: "authorized",
    sourceMode: "real-private-pilot",
    episodeId: input.episodeId,
    workspaceIdentitySha256: input.workspaceIdentitySha256,
    authorizedAtEpochSecond: input.authorizedAtEpochSecond,
    startEpochSecond: input.startEpochSecond,
    policy: {
      schemaVersion: TASK1_PRIVATE_PILOT_POLICY_SCHEMA_VERSION,
      policyId: TASK1_PRIVATE_PILOT_POLICY_ID,
      sha256: TASK1_PRIVATE_PILOT_POLICY_SHA256,
    },
  };
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function storedFile(
  relativePath: StoredAuthorizationFile["relativePath"],
  mediaType: string,
  bytes: Uint8Array,
): StoredAuthorizationFile {
  return Object.freeze({
    relativePath,
    mediaType,
    byteLength: bytes.byteLength,
    rawSha256: rawSha256(bytes),
    bytes: copyBytes(bytes),
  });
}

function copyArtifactFiles(
  files: readonly StoredAuthorizationFile[],
): readonly PrivateEvaluationArtifactSetFile[] {
  return Object.freeze(
    files.map((file) =>
      Object.freeze({
        relativePath: file.relativePath,
        mediaType: file.mediaType,
        byteLength: file.byteLength,
        rawSha256: file.rawSha256,
        bytes: copyBytes(file.bytes),
      }),
    ),
  );
}

function buildInternal(
  candidate: unknown,
): BuiltTask1PrivatePilotAuthorizationV1 {
  const input = validateInput(candidate);
  const authorizedAt = safeEpochSecondIso(input.authorizedAtEpochSecond)!;
  const endEpochSecond =
    input.startEpochSecond + AUTHORIZATION_END_OFFSET_SECONDS;
  const asOf = safeEpochSecondIso(endEpochSecond)!;
  const expectedExportRunId =
    `task1_private_pilot_${input.startEpochSecond}_${input.episodeId.slice("episode_".length)}`;
  const authorization = deepFreeze({
    schemaVersion: TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
    authorization: {
      authorizedBy: "colin" as const,
      decision: "authorized" as const,
      sourceMode: "real-private-pilot" as const,
      episodeId: input.episodeId,
      workspaceIdentitySha256: input.workspaceIdentitySha256,
      authorizedAtEpochSecond: input.authorizedAtEpochSecond,
      authorizedAt,
      expectedExportRunId,
    },
    policy: input.policy,
    window: {
      startEpochSecond: input.startEpochSecond,
      endEpochSecond,
      durationSeconds: AUTHORIZATION_DURATION_SECONDS,
      semantics: "inclusive" as const,
      asOf,
    },
    handling: {
      purpose: "private-plumbing-evaluation-only" as const,
      storageMode: "local-only" as const,
      outputProfile: "metadata-only.v1" as const,
      screenshotBytesExported: false as const,
      screenshotPathsExported: false as const,
      ocrOrObservationTextExported: false as const,
      suggestionFieldsAllowed: false as const,
      rawCopyIntoBlabaseAllowed: false as const,
      cloudSyncAllowed: false as const,
      providerUploadAllowed: false as const,
      gitAllowed: false as const,
      legacyCaptureAllowed: false as const,
      manualRepairAllowed: false as const,
    },
    structuredEvidence: {
      authority: "preserved-current-work-evidence" as const,
      snapshotAt: "inclusive-window-end" as const,
      managedCodexRequired: true as const,
      githubIfUnconfigured: "null" as const,
      githubIfConfiguredReadFails: "reject-entire-window" as const,
      githubAsOfMustEqualSnapshotAsOf: true as const,
    },
    privacy: {
      consentBasis: "colin-explicit-private-development-evaluation" as const,
      dataSubjectScope: "colin-only" as const,
      manualScreenshotInspectionAllowed: false as const,
      uncertainPrivacyState: "reject-entire-window" as const,
      denylist: Object.freeze([
        "password-manager",
        "login-or-two-factor-authentication",
        "banking-or-payment",
        "email-messenger-or-direct-message",
        "token-secret-or-env-visible-terminal",
        "production-admin-or-real-user-data",
      ] as const),
    },
    quality: {
      rejectIssueCodes: Object.freeze([
        "NO_SCREENSHOT_METADATA_IN_WINDOW",
        "CAPTURE_GAP_DETECTED",
        "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
        "DATABASE_SCHEMA_USER_VERSION_UNSET",
      ] as const),
      allowWarningIssueCodes: Object.freeze([
        "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
        "OPTIONAL_SOURCE_METADATA_MISSING",
      ] as const),
    },
    retention: {
      incompleteStagingSeconds: 3_600 as const,
      dayflowRawMaximumSeconds: 86_400 as const,
      sealedPrivateInputMaximumSeconds: 2_592_000 as const,
      expirationAction: "delete" as const,
    },
    failurePolicy: {
      privacyViolationOrUncertainty: "reject-entire-window" as const,
      sourceOrQualificationFailure: "reject-entire-window" as const,
      manualPostHocCorrectionAllowed: false as const,
      retryRule: "collect-new-episode" as const,
    },
    canonicalization: {
      storedAuthorization: "rfc8785-jcs.utf8.lf.v1" as const,
      identityHashDomain:
        TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
      identityPreimage:
        "authorization-without-self-hash-or-publication-metadata" as const,
    },
  }) satisfies Task1PrivatePilotAuthorizationManifestV1;
  const identitySha256 = domainSeparatedSha256(
    TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
    authorization,
  );
  const authorizationBytes = canonicalJsonLfBytes(authorization);
  const identityBytes = encoder.encode(identitySha256);
  const files = Object.freeze([
    storedFile(
      TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER[0],
      "application/json",
      authorizationBytes,
    ),
    storedFile(
      TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER[1],
      "text/plain; charset=us-ascii",
      identityBytes,
    ),
    storedFile(
      TASK1_PRIVATE_PILOT_AUTHORIZATION_FILE_ORDER[2],
      "text/plain; charset=us-ascii",
      identityBytes,
    ),
  ]);
  const result = Object.freeze({
    descriptor: Object.freeze({
      schemaVersion: TASK1_PRIVATE_PILOT_AUTHORIZATION_SCHEMA_VERSION,
      identityHashDomain:
        TASK1_PRIVATE_PILOT_AUTHORIZATION_IDENTITY_HASH_DOMAIN,
      identitySha256,
      authorizationByteLength: authorizationBytes.byteLength,
      authorizationRawSha256: rawSha256(authorizationBytes),
      episodeId: input.episodeId,
      sourceMode: "real-private-pilot" as const,
      expectedExportRunId,
      startEpochSecond: input.startEpochSecond,
      endEpochSecond,
      asOf,
    }),
    authorization,
    copyArtifactFiles: () => copyArtifactFiles(files),
  });
  builtAuthorizationBrand.add(result);
  return result;
}

export function buildTask1PrivatePilotAuthorizationV1(
  input: BuildTask1PrivatePilotAuthorizationV1Input,
): BuiltTask1PrivatePilotAuthorizationV1 {
  try {
    return buildInternal(input);
  } catch (error) {
    if (error instanceof Task1PrivatePilotAuthorizationErrorV1) throw error;
    return fail("INPUT_INVALID");
  }
}

function pathComponentsFor(
  authorization: BuiltTask1PrivatePilotAuthorizationV1,
): readonly string[] {
  if (!builtAuthorizationBrand.has(authorization)) {
    return fail("INPUT_INVALID");
  }
  return Object.freeze([
    ".local",
    "dayflow-ablation",
    "inputs",
    TASK1_PRIVATE_PILOT_POLICY_ID,
    "authorizations",
    authorization.descriptor.identitySha256,
  ]);
}

function freezeVerified(
  value: VerifiedPrivateEvaluationArtifactSet,
): VerifiedPrivateEvaluationArtifactSet {
  return Object.freeze({
    relativeDirectory: value.relativeDirectory,
    directoryMode: value.directoryMode,
    files: Object.freeze(
      value.files.map((file) => Object.freeze({ ...file })),
    ),
  });
}

export async function publishTask1PrivatePilotAuthorizationV1(input: Readonly<{
  dataRoot: string;
  authorization: BuiltTask1PrivatePilotAuthorizationV1;
}>): Promise<VerifiedPrivateEvaluationArtifactSet> {
  try {
    const pathComponents = pathComponentsFor(input.authorization);
    return freezeVerified(
      await publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: input.dataRoot,
        pathComponents,
        files: input.authorization.copyArtifactFiles(),
      }),
    );
  } catch (error) {
    if (
      error instanceof Task1PrivatePilotAuthorizationErrorV1 &&
      error.issueCode === "INPUT_INVALID"
    ) {
      throw error;
    }
    return fail("PUBLICATION_FAILED");
  }
}

export async function verifyPublishedTask1PrivatePilotAuthorizationV1(
  input: Readonly<{
    dataRoot: string;
    authorization: BuiltTask1PrivatePilotAuthorizationV1;
  }>,
): Promise<VerifiedPrivateEvaluationArtifactSet> {
  try {
    const pathComponents = pathComponentsFor(input.authorization);
    return freezeVerified(
      await verifyPrivateEvaluationArtifactSetReadback({
        dataRoot: input.dataRoot,
        pathComponents,
        expectedFiles: input.authorization.copyArtifactFiles(),
      }),
    );
  } catch (error) {
    if (
      error instanceof Task1PrivatePilotAuthorizationErrorV1 &&
      error.issueCode === "INPUT_INVALID"
    ) {
      throw error;
    }
    return fail("VERIFICATION_FAILED");
  }
}
