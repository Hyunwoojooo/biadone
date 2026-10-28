import { createHash } from "node:crypto";

import { z } from "zod";

const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicNumberIsInteger = Number.isInteger;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicReflectApply = Reflect.apply as (
  target: (...args: never[]) => unknown,
  receiver: unknown,
  argumentsList: readonly unknown[]
) => unknown;
const IntrinsicSet = Set;
const intrinsicSetAdd = Set.prototype.add;
const intrinsicSetDelete = Set.prototype.delete;
const intrinsicSetHas = Set.prototype.has;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicStringIncludes = String.prototype.includes;
const {
  digest: intrinsicHashDigest,
  update: intrinsicHashUpdate
} = createHash("sha256");

function invokeIntrinsic<Result>(
  target: (...args: never[]) => unknown,
  receiver: unknown,
  args: readonly unknown[]
): Result {
  return intrinsicReflectApply(target, receiver, args) as Result;
}

const ID_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/u;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/u;
const UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const FORBIDDEN_TEXT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

const MAX_DEFAULT_ARRAY = 256;
const MAX_SOURCE_REFS = 32;
const MAX_COVERAGE_INTERVALS = 1_024;
const MAX_ARTIFACTS = 256;
const MAX_BLOB_BYTES = 10_485_760n;
const MAX_BUNDLE_BYTES = 536_870_912n;
const MAX_WINDOW_MS = 86_400_000n;
const MAX_COVERAGE_COUNT = 1_000_000;
const MAX_SAFE_COUNTER = Number.MAX_SAFE_INTEGER;

export function boundedJsonUnsignedIntegerSchema(
  maximum: number,
  minimum = 0
) {
  return z
    .number()
    .int()
    .min(minimum)
    .max(Math.min(maximum, MAX_SAFE_COUNTER))
    .refine((value) => !Object.is(value, -0), {
      message: "Unsigned JSON integers must not use negative zero"
    });
}

export const jsonUnsignedIntegerSchema =
  boundedJsonUnsignedIntegerSchema(MAX_SAFE_COUNTER);

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = invokeIntrinsic<number>(intrinsicStringCharCodeAt, value, [
      index
    ]);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = invokeIntrinsic<number>(intrinsicStringCharCodeAt, value, [
        index + 1
      ]);
      if (!intrinsicNumberIsInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function unicodeScalarLength(value: string): number {
  return [...value].length;
}

function boundedSafeString(maximum: number, minimum = 0) {
  return z.string().superRefine((value, context) => {
    const length = unicodeScalarLength(value);
    if (
      !isUnicodeScalarString(value) ||
      value.normalize("NFC") !== value ||
      FORBIDDEN_TEXT_PATTERN.test(value) ||
      length < minimum ||
      length > maximum
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `String must be NFC Unicode scalar text of length ${minimum}..${maximum} without control or bidi formatting characters`
      });
    }
  });
}

export const identifierSchema = z.string().regex(ID_PATTERN);
export const evidenceIdSchema = identifierSchema;
export const schemaVersionSchema = z.string().regex(VERSION_PATTERN);
export const sha256HexSchema = z.string().regex(SHA256_PATTERN);
export const reasonCodeSchema = z.string().regex(REASON_CODE_PATTERN);
export const canonicalDecimalSchema = z.string().regex(DECIMAL_PATTERN);
export const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN)
  .refine(
    (value) => {
      const epoch = Date.parse(value);
      return (
        intrinsicNumberIsFinite(epoch) &&
        new Date(epoch).toISOString() === value
      );
    },
    { message: "Timestamp must be a real canonical UTC millisecond instant" }
  );

export const dataOriginSchema = z.enum(["synthetic", "live"]);
export const studyPhaseSchema = z.enum([
  "contract_conformance",
  "private_pilot",
  "directional_study"
]);

export const evidenceOriginPhaseSchema = z
  .object({
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.dataOrigin === "synthetic" &&
        value.studyPhase === "contract_conformance") ||
      (value.dataOrigin === "live" &&
        (value.studyPhase === "private_pilot" ||
          value.studyPhase === "directional_study"));
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "Evidence data origin and study phase are incompatible"
      });
    }
  });

export type EvidenceOriginPhase = z.infer<typeof evidenceOriginPhaseSchema>;

export const DAYFLOW_ARTIFACT_REGISTRY = [
  ["dayflow-export-manifest", "dayflow-screen-evidence-export-v0.1", "blabase.dayflow-screen-evidence-export.v0.1"],
  ["normalized-screen-evidence", "dayflow-normalized-evidence-v0.1", "blabase.dayflow-normalized-evidence.v0.1"],
  ["artifact-layout-config", "dayflow-ablation-artifact-layout-config-v0.2", "blabase.dayflow-ablation.artifact-layout-config.v0.2"],
  ["experiment-manifest", "dayflow-ablation-experiment-manifest-v0.2", "blabase.dayflow-ablation.experiment-manifest.v0.2"],
  ["evaluation-execution-freeze", "dayflow-ablation-evaluation-execution-freeze-v0.3", "blabase.dayflow-ablation.evaluation-execution-freeze.v0.3"],
  ["live-collection-freeze", "dayflow-ablation-live-collection-freeze-v0.3", "blabase.dayflow-ablation.live-collection-freeze.v0.3"],
  ["human-approval-record", "dayflow-ablation-human-approval-v0.1", "blabase.dayflow-ablation.human-approval.v0.1"],
  ["study-protocol", "dayflow-ablation-study-protocol-v0.3", "blabase.dayflow-ablation.study-protocol.v0.3"],
  ["request-order-manifest", "dayflow-ablation-request-order-manifest-v0.1", "blabase.dayflow-ablation.request-order-manifest.v0.1"],
  ["request-issuance-receipt", "dayflow-ablation-request-issuance-receipt-v0.1", "blabase.dayflow-ablation.request-issuance-receipt.v0.1"],
  ["blind-permutation", "dayflow-ablation-blind-permutation-v0.1", "blabase.dayflow-ablation.blind-permutation.v0.1"],
  ["candidate-dataset-generation", "dayflow-ablation-candidate-dataset-generation-v0.1", "blabase.dayflow-ablation.candidate-dataset-generation.v0.1"],
  ["exclusion-decision", "dayflow-ablation-exclusion-decision-v0.1", "blabase.dayflow-ablation.exclusion-decision.v0.1"],
  ["exclusion-closure", "dayflow-ablation-exclusion-closure-v0.1", "blabase.dayflow-ablation.exclusion-closure.v0.1"],
  ["final-dataset-manifest", "dayflow-ablation-final-dataset-manifest-v0.1", "blabase.dayflow-ablation.final-dataset-manifest.v0.1"],
  ["final-dataset-binding", "dayflow-ablation-final-dataset-binding-v0.1", "blabase.dayflow-ablation.final-dataset-binding.v0.1"],
  ["pilot-verification-attestation", "dayflow-ablation-pilot-verification-attestation-v0.1", "blabase.dayflow-ablation.pilot-verification-attestation.v0.1"],
  ["evaluation-checkpoint", "dayflow-ablation-checkpoint-v0.2", "blabase.dayflow-ablation.checkpoint.v0.2"],
  ["checkpoint-completion", "dayflow-ablation-checkpoint-completion-v0.1", "blabase.dayflow-ablation.checkpoint-completion.v0.1"],
  ["a0-arm-input", "dayflow-ablation-arm-input-v0.4", "blabase.dayflow-ablation.arm-input.a0.v0.4"],
  ["a1-arm-input", "dayflow-ablation-arm-input-v0.4", "blabase.dayflow-ablation.arm-input.a1.v0.4"],
  ["b-arm-input", "dayflow-ablation-arm-input-v0.4", "blabase.dayflow-ablation.arm-input.b.v0.4"],
  ["c-arm-input", "dayflow-ablation-arm-input-v0.4", "blabase.dayflow-ablation.arm-input.c.v0.4"],
  ["semantic-output", "dayflow-ablation-semantic-output-v0.1", "blabase.dayflow-ablation.semantic-output.v0.1"],
  ["arm-run", "dayflow-ablation-run-v0.4", "blabase.dayflow-ablation.run.v0.4"],
  ["run-results", "dayflow-ablation-run-results-v0.1", "blabase.dayflow-ablation.run-results.v0.1"],
  ["output-review", "dayflow-ablation-output-review-v0.2", "blabase.dayflow-ablation.output-review.v0.2"],
  ["pair-preference-review", "dayflow-ablation-pair-preference-review-v0.2", "blabase.dayflow-ablation.pair-preference-review.v0.2"],
  ["deletion-receipt", "dayflow-ablation-deletion-receipt-v0.1", "blabase.dayflow-ablation.deletion-receipt.v0.1"],
  ["aggregate", "dayflow-ablation-aggregate-v0.1", "blabase.dayflow-ablation.aggregate.v0.1"]
] .map(([artifactClass, schemaVersion, hashDomain]) => ({
  artifactClass: artifactClass!,
  schemaVersion: schemaVersion!,
  hashDomain: hashDomain!,
  storageMode: "standalone" as const
})) as readonly {
  artifactClass: string;
  schemaVersion: string;
  hashDomain: string;
  storageMode: "standalone";
}[];

DAYFLOW_ARTIFACT_REGISTRY.forEach((entry) => Object.freeze(entry));
Object.freeze(DAYFLOW_ARTIFACT_REGISTRY);

export type DayflowArtifactClass =
  (typeof DAYFLOW_ARTIFACT_REGISTRY)[number]["artifactClass"];

const registryByClass = new Map(
  DAYFLOW_ARTIFACT_REGISTRY.map((entry) => [entry.artifactClass, entry])
);

const detachedFieldsByClass: Readonly<Record<string, string>> = {
  "dayflow-export-manifest": "detachedManifestSha256",
  "normalized-screen-evidence": "dayflowNormalizedEvidenceHash",
  "artifact-layout-config": "artifactLayoutConfigSha256",
  "experiment-manifest": "experimentManifestSha256",
  "evaluation-execution-freeze": "evaluationExecutionFreezeSha256",
  "live-collection-freeze": "liveCollectionFreezeSha256",
  "human-approval-record": "approvalRecordSha256",
  "study-protocol": "studyProtocolHash",
  "request-order-manifest": "requestOrderManifestSha256",
  "request-issuance-receipt": "requestIssuanceReceiptSha256",
  "blind-permutation": "permutationHash",
  "candidate-dataset-generation": "candidateDatasetGenerationSha256",
  "exclusion-decision": "exclusionDecisionSha256",
  "exclusion-closure": "exclusionClosureSha256",
  "final-dataset-manifest": "datasetSha256",
  "final-dataset-binding": "finalDatasetBindingSha256",
  "pilot-verification-attestation": "pilotVerificationAttestationSha256",
  "evaluation-checkpoint": "checkpointSha256",
  "checkpoint-completion": "checkpointCompletionSha256",
  "a0-arm-input": "armInputHash",
  "a1-arm-input": "armInputHash",
  "b-arm-input": "armInputHash",
  "c-arm-input": "armInputHash",
  "semantic-output": "semanticOutputSha256",
  "arm-run": "runSha256",
  "run-results": "runResultsSha256",
  "output-review": "outputReviewSha256",
  "pair-preference-review": "pairPreferenceReviewSha256",
  "deletion-receipt": "deletionReceiptSha256",
  aggregate: "aggregateSha256"
};

const registeredDomains = DAYFLOW_ARTIFACT_REGISTRY.map(
  (entry) => entry.hashDomain
) as [string, ...string[]];
export const registeredHashDomainSchema = z.enum(registeredDomains);

export function getDayflowArtifactRegistration(artifactClass: string) {
  const registration = registryByClass.get(artifactClass);
  if (!registration) {
    throw new TypeError(`Unregistered Dayflow artifact class: ${artifactClass}`);
  }
  return registration;
}

function assertCanonicalJsonValue(
  value: unknown,
  ancestors: Set<object>
): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (!isUnicodeScalarString(value)) {
      throw new TypeError("JCS strings must contain only Unicode scalar values");
    }
    return intrinsicJsonStringify(value);
  }
  if (typeof value === "number") {
    if (!intrinsicNumberIsFinite(value)) {
      throw new TypeError("JCS numbers must be finite JSON numbers");
    }
    return intrinsicJsonStringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`JCS does not support ${typeof value}`);
  }
  if (invokeIntrinsic<boolean>(intrinsicSetHas, ancestors, [value])) {
    throw new TypeError("JCS does not support cyclic values");
  }
  invokeIntrinsic<Set<object>>(intrinsicSetAdd, ancestors, [value]);
  try {
    if (intrinsicArrayIsArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!invokeIntrinsic<boolean>(intrinsicObjectHasOwnProperty, value, [index])) {
          throw new TypeError("JCS does not support sparse arrays");
        }
        entries[entries.length] = assertCanonicalJsonValue(
          value[index],
          ancestors
        );
      }
      let serializedEntries = "";
      for (let index = 0; index < entries.length; index += 1) {
        if (index > 0) serializedEntries += ",";
        serializedEntries += entries[index];
      }
      return `[${serializedEntries}]`;
    }

    const prototype = intrinsicObjectGetPrototypeOf(value);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) {
      throw new TypeError("JCS supports only plain JSON objects");
    }
    const objectValue = value as Record<string, unknown>;
    const keys = intrinsicObjectKeys(objectValue);
    for (let index = 1; index < keys.length; index += 1) {
      const key = keys[index];
      let insertionIndex = index - 1;
      while (insertionIndex >= 0 && keys[insertionIndex] > key) {
        keys[insertionIndex + 1] = keys[insertionIndex];
        insertionIndex -= 1;
      }
      keys[insertionIndex + 1] = key;
    }

    let serializedEntries = "";
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!isUnicodeScalarString(key)) {
        throw new TypeError(
          "JCS object keys must contain only Unicode scalar values"
        );
      }
      if (index > 0) serializedEntries += ",";
      serializedEntries += `${intrinsicJsonStringify(
        key
      )}:${assertCanonicalJsonValue(objectValue[key], ancestors)}`;
    }
    return `{${serializedEntries}}`;
  } finally {
    invokeIntrinsic<boolean>(intrinsicSetDelete, ancestors, [value]);
  }
}

/** RFC 8785/JCS serialization for already-parsed JSON-compatible values. */
export function jcsCanonicalize(value: unknown): string {
  return assertCanonicalJsonValue(value, new IntrinsicSet());
}

export function domainSeparatedSha256(
  domain: string,
  value: unknown
): string {
  if (
    domain.length === 0 ||
    invokeIntrinsic<boolean>(intrinsicStringIncludes, domain, ["\u0000"])
  ) {
    throw new TypeError("Hash domain must be non-empty and contain no NUL");
  }
  const hash = createHash("sha256");
  invokeIntrinsic(intrinsicHashUpdate, hash, [domain, "utf8"]);
  invokeIntrinsic(intrinsicHashUpdate, hash, ["\u0000", "utf8"]);
  invokeIntrinsic(intrinsicHashUpdate, hash, [
    jcsCanonicalize(value),
    "utf8"
  ]);
  return invokeIntrinsic<string>(intrinsicHashDigest, hash, ["hex"]);
}

function detachedPreimage(
  value: Readonly<Record<string, unknown>>,
  detachedField: string
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(value, detachedField)) {
    throw new TypeError(`Missing detached hash field: ${detachedField}`);
  }
  const preimage: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key !== detachedField) preimage[key] = value[key];
  }
  return preimage;
}

export function hashRegisteredArtifact(
  artifactClass: string,
  value: Readonly<Record<string, unknown>>
): string {
  const registration = getDayflowArtifactRegistration(artifactClass);
  const detachedField = detachedFieldsByClass[artifactClass];
  if (!detachedField) {
    throw new TypeError(`No detached hash field for: ${artifactClass}`);
  }
  return domainSeparatedSha256(
    registration.hashDomain,
    detachedPreimage(value, detachedField)
  );
}

export function verifyDetachedHash(input: {
  domain: string;
  value: Readonly<Record<string, unknown>>;
  detachedField: string;
}): boolean {
  const claimed = input.value[input.detachedField];
  return (
    typeof claimed === "string" &&
    SHA256_PATTERN.test(claimed) &&
    claimed ===
      domainSeparatedSha256(
        input.domain,
        detachedPreimage(input.value, input.detachedField)
      )
  );
}

export function verifyRegisteredArtifactHash(
  artifactClass: string,
  value: Readonly<Record<string, unknown>>
): boolean {
  const registration = getDayflowArtifactRegistration(artifactClass);
  const detachedField = detachedFieldsByClass[artifactClass];
  if (!detachedField) return false;
  try {
    return verifyDetachedHash({
      domain: registration.hashDomain,
      value,
      detachedField
    });
  } catch {
    return false;
  }
}

function decimalAtMost(maximum: bigint, positive = false) {
  return canonicalDecimalSchema.refine(
    (value) => {
      const numeric = BigInt(value);
      return (!positive || numeric > 0n) && numeric <= maximum;
    },
    { message: `Canonical decimal is outside the allowed bound ${maximum}` }
  );
}

const relativePathSchema = boundedSafeString(512, 1).refine(
  (value) => {
    if (
      value.startsWith("/") ||
      value.startsWith("\\") ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) ||
      value.includes("\\")
    ) {
      return false;
    }
    const segments = value.split("/");
    return segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    );
  },
  { message: "Path must be a normalized, non-escaping repository-relative path" }
);

const mimeTypeSchema = z.enum(["image/jpeg", "image/png"]);
const coverageCountSchema = boundedJsonUnsignedIntegerSchema(
  MAX_COVERAGE_COUNT
);

export const coverageReasonSchema = z.enum([
  "running",
  "paused",
  "locked",
  "policy-denied",
  "missing",
  "read-failed",
  "unavailable"
]);

const dayflowCoverageIntervalStructuralSchema = z
  .object({
    start: utcTimestampSchema,
    end: utcTimestampSchema,
    reason: coverageReasonSchema,
    expectedFrameCount: coverageCountSchema,
    observedFrameCount: coverageCountSchema,
    rejectedFrameCount: coverageCountSchema
  })
  .strict();

export const dayflowCoverageIntervalSchema =
  dayflowCoverageIntervalStructuralSchema.superRefine((value, context) => {
    if (value.start >= value.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "Coverage interval must be non-empty"
      });
    }
    if (value.rejectedFrameCount > value.observedFrameCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectedFrameCount"],
        message: "Rejected frame count cannot exceed observed frame count"
      });
    }
  });

export const dayflowCoverageStructuralSchema = z
  .object({
    intervals: z
      .array(dayflowCoverageIntervalStructuralSchema)
      .max(MAX_COVERAGE_INTERVALS),
    expectedFrameCount: coverageCountSchema,
    observedFrameCount: coverageCountSchema,
    rejectedFrameCount: coverageCountSchema
  })
  .strict();

export const dayflowCoverageSchema = z
  .object({
    intervals: z
      .array(dayflowCoverageIntervalSchema)
      .min(1)
      .max(MAX_COVERAGE_INTERVALS),
    expectedFrameCount: coverageCountSchema,
    observedFrameCount: coverageCountSchema,
    rejectedFrameCount: coverageCountSchema
  })
  .strict()
  .superRefine((value, context) => {
    const sums = value.intervals.reduce(
      (current, interval) => ({
        expected: current.expected + interval.expectedFrameCount,
        observed: current.observed + interval.observedFrameCount,
        rejected: current.rejected + interval.rejectedFrameCount
      }),
      { expected: 0, observed: 0, rejected: 0 }
    );
    if (
      sums.expected !== value.expectedFrameCount ||
      sums.observed !== value.observedFrameCount ||
      sums.rejected !== value.rejectedFrameCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Top-level coverage counts must equal interval sums"
      });
    }
    if (value.rejectedFrameCount > value.observedFrameCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectedFrameCount"],
        message: "Rejected frame count cannot exceed observed frame count"
      });
    }
    for (let index = 1; index < value.intervals.length; index += 1) {
      const previous = value.intervals[index - 1]!;
      const current = value.intervals[index]!;
      if (previous.end !== current.start) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intervals", index, "start"],
          message: "Coverage intervals must be a contiguous canonical partition"
        });
      }
      if (previous.reason === current.reason) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intervals", index, "reason"],
          message: "Adjacent equal coverage reasons must be coalesced"
        });
      }
    }
  });

export type DayflowCoverage = z.infer<typeof dayflowCoverageSchema>;

const sourceFileHashSchema = z
  .object({ relativePath: relativePathSchema, sha256: sha256HexSchema })
  .strict();

export const dayflowCaptureConfigSchema = z
  .object({
    captureIntervalMs: decimalAtMost(MAX_WINDOW_MS, true),
    maxWindowDurationMs: decimalAtMost(MAX_WINDOW_MS, true),
    maxArtifactsPerExport: decimalAtMost(BigInt(MAX_ARTIFACTS), true),
    maxBlobBytes: decimalAtMost(MAX_BLOB_BYTES, true),
    allowedMimeTypes: z.array(mimeTypeSchema).min(1).max(2)
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.allowedMimeTypes, compareStrings)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedMimeTypes"],
        message: "Allowed MIME types must be sorted and unique"
      });
    }
  });

const syntheticSnapshotIdentitySchema = z
  .object({
    snapshotKind: z.literal("synthetic-fixture"),
    fixtureSetId: identifierSchema,
    fixtureGeneratorVersion: schemaVersionSchema,
    fixtureGeneratorSeed: boundedSafeString(256, 1),
    fixtureGeneratorConfigSha256: sha256HexSchema
  })
  .strict();

const liveSnapshotIdentitySchema = z
  .object({
    snapshotKind: z.literal("dayflow-stable-snapshot"),
    snapshotAlgorithmVersion: schemaVersionSchema,
    snapshotId: identifierSchema,
    databaseSchemaFingerprint: sha256HexSchema,
    mainDatabaseSha256: sha256HexSchema,
    walState: z.enum(["none", "included"]),
    walSha256: sha256HexSchema.optional(),
    stableSnapshotMarkerSha256: sha256HexSchema,
    createdAt: utcTimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.walState === "included") !== (value.walSha256 !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["walSha256"],
        message: "WAL hash presence must exactly match included WAL state"
      });
    }
  });

export const dayflowDatabaseSnapshotIdentitySchema = z.union([
  syntheticSnapshotIdentitySchema,
  liveSnapshotIdentitySchema
]);

const captureAttestationSchema = z
  .object({
    attestationSchemaVersion: z.literal(
      "dayflow-pseudonymous-capture-attestation-v0.1"
    ),
    pseudonymousSubjectId: identifierSchema,
    policyVersion: schemaVersionSchema,
    policySha256: sha256HexSchema,
    attestedAt: utcTimestampSchema
  })
  .strict();

export const dayflowExportArtifactSchema = z
  .object({
    sourceArtifactId: identifierSchema,
    sourceRowId: canonicalDecimalSchema,
    capturedAt: utcTimestampSchema,
    sequenceWithinSecond: decimalAtMost(BigInt(MAX_COVERAGE_COUNT)),
    idleSeconds: boundedJsonUnsignedIntegerSchema(86_400),
    relativeBlobRef: relativePathSchema,
    mimeType: mimeTypeSchema,
    byteSize: decimalAtMost(MAX_BLOB_BYTES),
    sha256: sha256HexSchema,
    privacyState: z.enum(["synthetic_fixture", "consented_live"]),
    captureConsentRevision: schemaVersionSchema,
    capturePolicyVersion: schemaVersionSchema,
    capturePolicyDecision: z.literal("allow"),
    pseudonymousDisplayAttestation: captureAttestationSchema,
    pseudonymousWindowAttestation: captureAttestationSchema,
    placeholderState: z.enum([
      "synthetic_fixture",
      "verified_non_placeholder"
    ]),
    availability: z.literal("available")
  })
  .strict();

export type DayflowExportArtifact = z.infer<
  typeof dayflowExportArtifactSchema
>;

export function compareCanonicalDecimal(left: string, right: string): number {
  const leftValue = BigInt(canonicalDecimalSchema.parse(left));
  const rightValue = BigInt(canonicalDecimalSchema.parse(right));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareDayflowExportArtifacts(
  left: Pick<DayflowExportArtifact, "capturedAt" | "sourceRowId">,
  right: Pick<DayflowExportArtifact, "capturedAt" | "sourceRowId">
): number {
  return (
    compareStrings(left.capturedAt, right.capturedAt) ||
    compareCanonicalDecimal(left.sourceRowId, right.sourceRowId)
  );
}

function isSortedUnique<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) >= 0) return false;
  }
  return true;
}

export function verifyArtifactBlobBytes(
  artifact: Pick<DayflowExportArtifact, "byteSize" | "sha256">,
  bytes: Uint8Array
): boolean {
  if (BigInt(bytes.byteLength) !== BigInt(artifact.byteSize)) return false;
  const actual = createHash("sha256").update(bytes).digest("hex");
  return actual === artifact.sha256;
}

const exportManifestObjectSchema = z
  .object({
    contract: z.literal("dayflow-screen-evidence-export-v0.1"),
    schemaVersion: z.literal("dayflow-screen-evidence-export-v0.1"),
    exportId: identifierSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    exportedAt: utcTimestampSchema,
    windowStart: utcTimestampSchema,
    windowEnd: utcTimestampSchema,
    dayflowCommitSha: z.string().regex(COMMIT_SHA_PATTERN),
    sourceFileHashes: z
      .array(sourceFileHashSchema)
      .min(1)
      .max(MAX_ARTIFACTS),
    packageResolvedSha256: sha256HexSchema,
    capturePolicyVersion: schemaVersionSchema,
    captureConfig: dayflowCaptureConfigSchema,
    databaseSnapshotIdentity: dayflowDatabaseSnapshotIdentitySchema,
    consentRevision: schemaVersionSchema,
    retentionPolicyId: identifierSchema,
    coverage: dayflowCoverageSchema,
    artifacts: z.array(dayflowExportArtifactSchema).max(MAX_ARTIFACTS),
    detachedManifestSha256: sha256HexSchema
  })
  .strict();

export const dayflowScreenEvidenceExportSchema =
  exportManifestObjectSchema.superRefine((value, context) => {
    const phase = evidenceOriginPhaseSchema.safeParse({
      lineageClass: value.lineageClass,
      dataOrigin: value.dataOrigin,
      studyPhase: value.studyPhase
    });
    if (!phase.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "Export origin/phase is invalid"
      });
    }
    const snapshotMatchesOrigin =
      (value.dataOrigin === "synthetic" &&
        value.databaseSnapshotIdentity.snapshotKind ===
          "synthetic-fixture") ||
      (value.dataOrigin === "live" &&
        value.databaseSnapshotIdentity.snapshotKind ===
          "dayflow-stable-snapshot");
    if (!snapshotMatchesOrigin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["databaseSnapshotIdentity", "snapshotKind"],
        message: "Export origin and database snapshot kind are incompatible"
      });
    }
    if (value.windowStart >= value.windowEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["windowEnd"],
        message: "Export window must be non-empty"
      });
    } else {
      const duration = BigInt(
        Date.parse(value.windowEnd) - Date.parse(value.windowStart)
      );
      if (duration > BigInt(value.captureConfig.maxWindowDurationMs)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["windowEnd"],
          message: "Export window exceeds configured duration"
        });
      }
    }
    if (value.exportedAt < value.windowEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exportedAt"],
        message: "Export publication must not precede window completion"
      });
    }
    const firstInterval = value.coverage.intervals[0];
    const lastInterval = value.coverage.intervals.at(-1);
    if (
      firstInterval?.start !== value.windowStart ||
      lastInterval?.end !== value.windowEnd
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "intervals"],
        message: "Coverage must exactly partition the export window"
      });
    }
    if (!isSortedUnique(value.sourceFileHashes, (left, right) =>
      compareStrings(left.relativePath, right.relativePath)
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFileHashes"],
        message: "Source file hashes must be sorted and unique by relative path"
      });
    }
    if (!isSortedUnique(value.artifacts, compareDayflowExportArtifacts)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: "Artifacts must use canonical capturedAt/numeric-sourceRowId order"
      });
    }
    const acceptedCount =
      value.coverage.observedFrameCount -
      value.coverage.rejectedFrameCount;
    if (value.artifacts.length !== acceptedCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: "Artifact count must equal observed minus rejected frame count"
      });
    }
    if (
      value.artifacts.length >
      Number(BigInt(value.captureConfig.maxArtifactsPerExport))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: "Artifact count exceeds configured maximum"
      });
    }
    let bundleBytes = 0n;
    const artifactIds = new Set<string>();
    const blobRefs = new Set<string>();
    for (let index = 0; index < value.artifacts.length; index += 1) {
      const artifact = value.artifacts[index]!;
      bundleBytes += BigInt(artifact.byteSize);
      if (
        BigInt(artifact.byteSize) > BigInt(value.captureConfig.maxBlobBytes)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "byteSize"],
          message: "Artifact exceeds configured blob byte maximum"
        });
      }
      if (!value.captureConfig.allowedMimeTypes.includes(artifact.mimeType)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "mimeType"],
          message: "Artifact MIME type is not enabled"
        });
      }
      if (
        artifact.capturedAt < value.windowStart ||
        artifact.capturedAt >= value.windowEnd
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "capturedAt"],
          message: "Artifact capture time is outside the half-open export window"
        });
      }
      if (
        artifact.captureConsentRevision !== value.consentRevision ||
        artifact.capturePolicyVersion !== value.capturePolicyVersion
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index],
          message: "Artifact consent/policy revision does not match its export"
        });
      }
      const attestationSubjectIds = [
        artifact.pseudonymousDisplayAttestation.pseudonymousSubjectId,
        artifact.pseudonymousWindowAttestation.pseudonymousSubjectId
      ];
      const allSyntheticSubjectIds = attestationSubjectIds.every((id) =>
        id.startsWith("synthetic-")
      );
      const hasAnySyntheticSubjectId = attestationSubjectIds.some((id) =>
        id.startsWith("synthetic-")
      );
      const validPrivacy =
        (value.dataOrigin === "synthetic" &&
          value.databaseSnapshotIdentity.snapshotKind ===
            "synthetic-fixture" &&
          artifact.privacyState === "synthetic_fixture" &&
          artifact.placeholderState === "synthetic_fixture" &&
          allSyntheticSubjectIds) ||
        (value.dataOrigin === "live" &&
          value.databaseSnapshotIdentity.snapshotKind ===
            "dayflow-stable-snapshot" &&
          artifact.privacyState === "consented_live" &&
          artifact.placeholderState === "verified_non_placeholder" &&
          !hasAnySyntheticSubjectId);
      if (!validPrivacy) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "privacyState"],
          message: "Artifact privacy/placeholder/attestation state conflicts with origin"
        });
      }
      if (
        artifact.pseudonymousDisplayAttestation.policyVersion !==
          value.capturePolicyVersion ||
        artifact.pseudonymousWindowAttestation.policyVersion !==
          value.capturePolicyVersion
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index],
          message: "Capture attestation policy version mismatch"
        });
      }
      if (
        artifact.pseudonymousDisplayAttestation.policySha256 !==
        artifact.pseudonymousWindowAttestation.policySha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index],
          message: "Display/window attestations must bind the same policy hash"
        });
      }
      if (artifactIds.has(artifact.sourceArtifactId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "sourceArtifactId"],
          message: "Source artifact IDs must be unique"
        });
      }
      if (blobRefs.has(artifact.relativeBlobRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts", index, "relativeBlobRef"],
          message: "Blob refs must have one manifest owner"
        });
      }
      artifactIds.add(artifact.sourceArtifactId);
      blobRefs.add(artifact.relativeBlobRef);
    }
    if (bundleBytes > MAX_BUNDLE_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: "Export bundle exceeds 512 MiB"
      });
    }
    if (!verifyRegisteredArtifactHash("dayflow-export-manifest", value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detachedManifestSha256"],
        message: "Detached export manifest hash mismatch"
      });
    }
  });

export type DayflowScreenEvidenceExport = z.infer<
  typeof dayflowScreenEvidenceExportSchema
>;

export function dayflowExportManifestSha256(
  value: Omit<DayflowScreenEvidenceExport, "detachedManifestSha256">
): string {
  return domainSeparatedSha256(
    "blabase.dayflow-screen-evidence-export.v0.1",
    value
  );
}

export const coverageCodeSchema = z.enum([
  "failure",
  "observed",
  "valid-empty"
]);

type ReadonlyDayflowCoverage = Readonly<
  Omit<DayflowCoverage, "intervals"> & {
    readonly intervals: readonly Readonly<
      DayflowCoverage["intervals"][number]
    >[];
  }
>;

export function classifyDayflowCoverage(input: {
  coverage: ReadonlyDayflowCoverage;
  artifacts: readonly unknown[];
}): z.infer<typeof coverageCodeSchema> {
  const acceptedCount =
    input.coverage.observedFrameCount - input.coverage.rejectedFrameCount;
  let hasFailureReason = false;
  let runningGap = false;
  let intentionallyEmptyReasons = true;
  for (let index = 0; index < input.coverage.intervals.length; index += 1) {
    const interval = input.coverage.intervals[index]!;
    if (
      interval.reason === "missing" ||
      interval.reason === "read-failed" ||
      interval.reason === "unavailable"
    ) {
      hasFailureReason = true;
    }
    if (
      interval.reason === "running" &&
      interval.observedFrameCount - interval.rejectedFrameCount !==
        interval.expectedFrameCount
    ) {
      runningGap = true;
    }
    if (
      interval.reason !== "paused" &&
      interval.reason !== "locked" &&
      interval.reason !== "policy-denied"
    ) {
      intentionallyEmptyReasons = false;
    }
  }
  if (
    hasFailureReason ||
    runningGap ||
    input.coverage.rejectedFrameCount > 0 ||
    acceptedCount !== input.artifacts.length
  ) {
    return "failure";
  }
  if (input.artifacts.length > 0) return "observed";
  const intentionallyEmpty =
    input.coverage.expectedFrameCount === 0 &&
    input.coverage.observedFrameCount === 0 &&
    input.coverage.rejectedFrameCount === 0 &&
    intentionallyEmptyReasons;
  return intentionallyEmpty ? "valid-empty" : "failure";
}

function classifyNormalizedDayflowCoverage(input: {
  coverage: DayflowCoverage;
  sourceArtifactHashes: readonly string[];
}): z.infer<typeof coverageCodeSchema> {
  const acceptedCount =
    input.coverage.observedFrameCount - input.coverage.rejectedFrameCount;
  const hasFailureReason = input.coverage.intervals.some((interval) =>
    ["missing", "read-failed", "unavailable"].includes(interval.reason)
  );
  const runningGap = input.coverage.intervals.some(
    (interval) =>
      interval.reason === "running" &&
      interval.observedFrameCount - interval.rejectedFrameCount !==
        interval.expectedFrameCount
  );
  if (
    hasFailureReason ||
    runningGap ||
    input.coverage.rejectedFrameCount > 0 ||
    (acceptedCount > 0) !== (input.sourceArtifactHashes.length > 0)
  ) {
    return "failure";
  }
  if (acceptedCount > 0) return "observed";
  const intentionallyEmpty =
    input.coverage.expectedFrameCount === 0 &&
    input.coverage.observedFrameCount === 0 &&
    input.coverage.rejectedFrameCount === 0 &&
    input.coverage.intervals.every((interval) =>
      ["paused", "locked", "policy-denied"].includes(interval.reason)
    );
  return intentionallyEmpty ? "valid-empty" : "failure";
}

export const fatalPrivacyIssueCodeSchema = z.enum([
  "PRIVACY_STATE_UNKNOWN",
  "CONSENT_REVISION_MISMATCH",
  "CAPTURE_POLICY_MISMATCH",
  "DENYLIST_BLOCKED",
  "DISPLAY_ATTESTATION_MISSING",
  "WINDOW_ATTESTATION_MISSING",
  "PLACEHOLDER_AMBIGUOUS",
  "SENSITIVE_CATEGORY",
  "RAW_CONTENT_FORBIDDEN",
  "CREDENTIAL_PATTERN",
  "ABSOLUTE_PATH_FORBIDDEN",
  "ORIGIN_PHASE_MISMATCH",
  "LIVE_SENTINEL_FORBIDDEN",
  "SYNTHETIC_ID_IN_LIVE"
]);

function isCanonicalJsonPointer(value: string): boolean {
  if (value === "") return true;
  if (!value.startsWith("/")) return false;
  for (const rawToken of value.slice(1).split("/")) {
    if (/~(?:[^01]|$)/u.test(rawToken)) return false;
    const token = rawToken.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (
      !isUnicodeScalarString(token) ||
      token.normalize("NFC") !== token ||
      (/^[0-9]+$/u.test(token) && !DECIMAL_PATTERN.test(token))
    ) {
      return false;
    }
  }
  return true;
}

export const canonicalJsonPointerSchema = boundedSafeString(512).refine(
  isCanonicalJsonPointer,
  { message: "Path must be a canonical RFC 6901 JSON Pointer" }
);

export const privacyIssueSchema = z
  .object({
    issueCode: fatalPrivacyIssueCodeSchema,
    artifactRef: identifierSchema.optional(),
    fieldPath: canonicalJsonPointerSchema.optional(),
    detectedAt: utcTimestampSchema
  })
  .strict();

export const privacyIssuesSchema = z
  .array(privacyIssueSchema)
  .max(MAX_DEFAULT_ARRAY);

export function hasFatalPrivacyIssue(
  issues: readonly z.infer<typeof privacyIssueSchema>[]
): boolean {
  return issues.length > 0;
}

const exportRefSchema = z
  .object({
    schemaVersion: z.literal("dayflow-screen-evidence-export-v0.1"),
    exportId: identifierSchema,
    detachedManifestSha256: sha256HexSchema
  })
  .strict();

export const sourceArtifactRefSchema = z
  .object({
    artifactType: z.literal("dayflow_export_frame"),
    exportRef: exportRefSchema,
    sourceRowId: canonicalDecimalSchema,
    blobSha256: sha256HexSchema
  })
  .strict();

export type SourceArtifactRef = z.infer<typeof sourceArtifactRefSchema>;

function compareSourceArtifactRefs(
  left: SourceArtifactRef,
  right: SourceArtifactRef
): number {
  return (
    compareStrings(left.exportRef.exportId, right.exportRef.exportId) ||
    compareCanonicalDecimal(left.sourceRowId, right.sourceRowId) ||
    compareStrings(left.blobSha256, right.blobSha256)
  );
}

const normalizedFrameSpanSchema = z
  .object({
    spanKind: z.literal("normalized_frame"),
    sourceArtifactRef: sourceArtifactRefSchema,
    startOffsetMs: boundedJsonUnsignedIntegerSchema(Number(MAX_WINDOW_MS)),
    endOffsetMs: boundedJsonUnsignedIntegerSchema(
      Number(MAX_WINDOW_MS),
      1
    )
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startOffsetMs >= value.endOffsetMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endOffsetMs"],
        message: "Frame capture span must be non-empty"
      });
    }
  });

const textOffsetUtf8SpanSchema = z
  .object({
    spanKind: z.literal("text_offset_utf8"),
    sourceArtifactRef: sourceArtifactRefSchema,
    normalizedTextSha256: sha256HexSchema,
    startByteOffset: jsonUnsignedIntegerSchema,
    endByteOffset: boundedJsonUnsignedIntegerSchema(MAX_SAFE_COUNTER, 1)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startByteOffset >= value.endByteOffset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endByteOffset"],
        message: "UTF-8 text capture span must be non-empty"
      });
    }
  });

export const captureSpanSchema = z.union([
  normalizedFrameSpanSchema,
  textOffsetUtf8SpanSchema
]);

export const claimClassSchema = z.enum([
  "VISIBLE_APPLICATION",
  "VISIBLE_SUBJECT",
  "VISIBLE_TASK_INTENT",
  "RECENT_FOCUS",
  "DISPLAY_TITLE_HINT",
  "TASK_COMPLETION",
  "VALIDATION_RESULT",
  "MERGE_STATE",
  "DEPLOYMENT_STATE",
  "DELIVERY_STATE",
  "EXTERNAL_MUTATION",
  "VERIFIED_WORK_CONTEXT",
  "INACTIVITY"
]);

export const allowedScreenClaimClassSchema = z.enum([
  "VISIBLE_APPLICATION",
  "VISIBLE_SUBJECT",
  "VISIBLE_TASK_INTENT",
  "RECENT_FOCUS",
  "DISPLAY_TITLE_HINT"
]);

export const screenClaimPolicySchema = z
  .object({
    policySchemaVersion: z.literal("dayflow-screen-claim-policy-v0.1"),
    lineageClass: z.literal("control"),
    allowedClasses: z.tuple([
      z.literal("VISIBLE_APPLICATION"),
      z.literal("VISIBLE_SUBJECT"),
      z.literal("VISIBLE_TASK_INTENT"),
      z.literal("RECENT_FOCUS"),
      z.literal("DISPLAY_TITLE_HINT")
    ]),
    forbiddenClasses: z.tuple([
      z.literal("TASK_COMPLETION"),
      z.literal("VALIDATION_RESULT"),
      z.literal("MERGE_STATE"),
      z.literal("DEPLOYMENT_STATE"),
      z.literal("DELIVERY_STATE"),
      z.literal("EXTERNAL_MUTATION"),
      z.literal("VERIFIED_WORK_CONTEXT"),
      z.literal("INACTIVITY")
    ]),
    structuredAuthorityWins: z.literal(true)
  })
  .strict();

const outputFieldPathSchema = z
  .string()
  .regex(/^\/items\/[0-2]\/(?:title|summary|caveatCodes\/(?:0|[1-9][0-9]*))$/u);
const confidenceBasisPointsSchema = boundedJsonUnsignedIntegerSchema(10_000);

const semanticCaveatCodeSchema = z.enum([
  "SCREEN_CONTEXT_ONLY",
  "NOT_COMPLETION_EVIDENCE",
  "NOT_ACTIONABLE",
  "NOT_OBSERVED_BY_SOURCE"
]);

const semanticOutputItemSchema = z
  .object({
    position: z.number().int().min(1).max(3),
    title: boundedSafeString(120, 1),
    summary: boundedSafeString(500, 1),
    caveatCodes: z.array(semanticCaveatCodeSchema).max(4),
    claimIds: z.array(identifierSchema).max(MAX_DEFAULT_ARRAY)
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.caveatCodes, compareStrings)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caveatCodes"],
        message: "Semantic caveat codes must be sorted and unique"
      });
    }
    if (!isSortedUnique(value.claimIds, compareStrings)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimIds"],
        message: "Semantic claim IDs must be sorted and unique"
      });
    }
  });

export const semanticOutputSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-semantic-output-v0.1"),
    presentationMode: z.literal("display_only"),
    status: z.enum(["suggestions_available", "no_suggestion"]),
    items: z.array(semanticOutputItemSchema).max(3)
  })
  .strict()
  .superRefine((value, context) => {
    const validCardinality =
      (value.status === "no_suggestion" && value.items.length === 0) ||
      (value.status === "suggestions_available" &&
        value.items.length >= 1 &&
        value.items.length <= 3);
    if (!validCardinality) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Semantic output status and item cardinality conflict"
      });
    }
    value.items.forEach((item, index) => {
      if (item.position !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "position"],
          message: "Semantic output positions must be contiguous from one"
        });
      }
    });
  });

export type SemanticOutput = z.infer<typeof semanticOutputSchema>;

/**
 * Standalone detached-hash form of the otherwise embedded semantic output.
 * Evaluation runs keep the plain value and bind this hash in `outputHash`.
 */
export const semanticOutputWithHashSchema = z
  .object({
    schemaVersion: z.literal("dayflow-ablation-semantic-output-v0.1"),
    presentationMode: z.literal("display_only"),
    status: z.enum(["suggestions_available", "no_suggestion"]),
    items: z.array(semanticOutputItemSchema).max(3),
    semanticOutputSha256: sha256HexSchema
  })
  .strict()
  .superRefine((value, context) => {
    const { semanticOutputSha256: _detachedHash, ...semanticOutput } = value;
    if (!semanticOutputSchema.safeParse(semanticOutput).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Semantic output payload is invalid"
      });
    }
    if (!verifyRegisteredArtifactHash("semantic-output", value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticOutputSha256"],
        message: "Detached semantic output hash mismatch"
      });
    }
  });

export type SemanticOutputWithHash = z.infer<
  typeof semanticOutputWithHashSchema
>;

export function semanticOutputSha256(value: SemanticOutput): string {
  return domainSeparatedSha256(
    "blabase.dayflow-ablation.semantic-output.v0.1",
    value
  );
}

export const acceptedClaimSchema = z
  .object({
    claimId: identifierSchema,
    outputFieldPath: outputFieldPathSchema,
    claimClass: allowedScreenClaimClassSchema,
    normalizedValueHash: sha256HexSchema,
    confidenceBasisPoints: confidenceBasisPointsSchema,
    fieldEvidenceId: identifierSchema
  })
  .strict();

export const fieldEvidenceSchema = z
  .object({
    fieldEvidenceId: identifierSchema,
    claimId: identifierSchema,
    outputFieldPath: outputFieldPathSchema,
    sourceArtifactRefs: z
      .array(sourceArtifactRefSchema)
      .min(1)
      .max(MAX_SOURCE_REFS),
    captureSpans: z.array(captureSpanSchema).min(1).max(MAX_DEFAULT_ARRAY)
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.sourceArtifactRefs, compareSourceArtifactRefs)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceArtifactRefs"],
        message: "Source artifact refs must be sorted and unique"
      });
    }
    if (
      !isSortedUnique(value.captureSpans, (left, right) =>
        compareStrings(jcsCanonicalize(left), jcsCanonicalize(right))
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureSpans"],
        message: "Capture spans must be sorted and unique by canonical union key"
      });
    }
    const sourceKeys = new Set(
      value.sourceArtifactRefs.map((source) => jcsCanonicalize(source))
    );
    for (const span of value.captureSpans) {
      if (!sourceKeys.has(jcsCanonicalize(span.sourceArtifactRef))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["captureSpans"],
          message: "Every capture span source must occur in sourceArtifactRefs"
        });
      }
    }
  });

export const rejectedClaimSchema = z
  .object({
    rejectedClaimId: identifierSchema,
    proposedOutputFieldPath: outputFieldPathSchema,
    claimClass: claimClassSchema,
    proposedValueHash: sha256HexSchema,
    reasonCode: z.enum([
      "FORBIDDEN_CLAIM_CLASS",
      "INSUFFICIENT_EVIDENCE",
      "PRIVACY_BLOCKED",
      "STRUCTURED_AUTHORITY_CONFLICT",
      "STALE_EVIDENCE",
      "COVERAGE_UNAVAILABLE",
      "AMBIGUOUS_IDENTITY"
    ]),
    sourceArtifactRefs: z
      .array(sourceArtifactRefSchema)
      .max(MAX_SOURCE_REFS),
    rejectedAt: utcTimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.sourceArtifactRefs, compareSourceArtifactRefs)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceArtifactRefs"],
        message: "Rejected source refs must be sorted and unique"
      });
    }
  });

const sealedAttentionResultAuthoritySchema = z
  .object({
    authorityType: z.literal("sealed_attention_result"),
    resultId: identifierSchema,
    resultSha256: sha256HexSchema
  })
  .strict();

const checkpointStructuredFieldAuthoritySchema = z
  .object({
    authorityType: z.literal("checkpoint_structured_field"),
    checkpointRef: z
      .object({
        schemaVersion: z.literal("dayflow-ablation-checkpoint-v0.2"),
        checkpointId: identifierSchema,
        checkpointSha256: sha256HexSchema
      })
      .strict(),
    authorityClass: z.enum([
      "attention_input",
      "attention_result",
      "board",
      "structured_evidence",
      "work_context_registry"
    ]),
    authoritySha256: sha256HexSchema
  })
  .strict();

export const structuredAuthorityRefSchema = z.discriminatedUnion(
  "authorityType",
  [
    sealedAttentionResultAuthoritySchema,
    checkpointStructuredFieldAuthoritySchema
  ]
);

export const conflictingClaimSchema = z
  .object({
    conflictId: identifierSchema,
    outputFieldPath: outputFieldPathSchema,
    screenClaimIds: z.array(identifierSchema).min(1).max(MAX_DEFAULT_ARRAY),
    structuredAuthorityRef: structuredAuthorityRefSchema,
    resolutionCode: z.enum([
      "STRUCTURED_AUTHORITY_WINS",
      "DROP_SCREEN_CLAIM"
    ]),
    reasonCode: z.enum([
      "STRUCTURED_AUTHORITY_CONFLICT",
      "AMBIGUOUS_IDENTITY",
      "STALE_EVIDENCE"
    ])
  })
  .strict()
  .superRefine((value, context) => {
    if (!isSortedUnique(value.screenClaimIds, compareStrings)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["screenClaimIds"],
        message: "Screen claim IDs must be sorted and unique"
      });
    }
  });

const normalizedEvidenceObjectSchema = z
  .object({
    schemaVersion: z.literal("dayflow-normalized-evidence-v0.1"),
    evidenceId: evidenceIdSchema,
    generationId: identifierSchema,
    lineageClass: z.literal("evidence"),
    dataOrigin: dataOriginSchema,
    studyPhase: studyPhaseSchema,
    studyProtocolHash: sha256HexSchema,
    extractorInputHash: sha256HexSchema,
    captureWindow: z
      .object({ start: utcTimestampSchema, end: utcTimestampSchema })
      .strict(),
    activityKind: boundedSafeString(256).nullable(),
    applicationCategory: boundedSafeString(256).nullable(),
    subjectLabel: boundedSafeString(256).nullable(),
    taskIntent: boundedSafeString(256).nullable(),
    stateClaim: boundedSafeString(256).nullable(),
    confidenceBasisPoints: confidenceBasisPointsSchema,
    coverageCode: coverageCodeSchema,
    normalizedCoverage: dayflowCoverageSchema,
    sourceExportRefs: z.array(exportRefSchema).length(1),
    sourceArtifactHashes: z
      .array(sha256HexSchema)
      .max(MAX_ARTIFACTS),
    preprocessingVersion: schemaVersionSchema,
    extractorVersion: schemaVersionSchema,
    model: boundedSafeString(256, 1),
    promptVersion: schemaVersionSchema,
    promptSha256: sha256HexSchema,
    configVersion: schemaVersionSchema,
    guardrailVersion: schemaVersionSchema,
    verificationStatus: z.enum(["verified", "rejected", "unavailable"]),
    reasonCodes: z.array(reasonCodeSchema).max(MAX_DEFAULT_ARRAY),
    semanticOutput: semanticOutputSchema,
    acceptedClaims: z.array(acceptedClaimSchema).max(MAX_DEFAULT_ARRAY),
    fieldEvidence: z.array(fieldEvidenceSchema).max(MAX_DEFAULT_ARRAY),
    rejectedClaims: z.array(rejectedClaimSchema).max(MAX_DEFAULT_ARRAY),
    conflictingClaims: z.array(conflictingClaimSchema).max(MAX_DEFAULT_ARRAY),
    expiresAt: utcTimestampSchema,
    dayflowNormalizedEvidenceHash: sha256HexSchema
  })
  .strict();

export const dayflowNormalizedEvidenceSchema =
  normalizedEvidenceObjectSchema.superRefine((value, context) => {
    if (
      !evidenceOriginPhaseSchema.safeParse({
        lineageClass: value.lineageClass,
        dataOrigin: value.dataOrigin,
        studyPhase: value.studyPhase
      }).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studyPhase"],
        message: "Normalized evidence origin/phase is invalid"
      });
    }
    if (value.captureWindow.start >= value.captureWindow.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captureWindow", "end"],
        message: "Capture window must be non-empty"
      });
    }
    if (value.expiresAt < value.captureWindow.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Normalized evidence cannot expire before capture completes"
      });
    }
    const expectedCoverageCode = classifyNormalizedDayflowCoverage({
      coverage: value.normalizedCoverage,
      sourceArtifactHashes: value.sourceArtifactHashes
    });
    if (value.coverageCode !== expectedCoverageCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverageCode"],
        message: "Coverage code does not match normalized coverage"
      });
    }
    const canonicalCollections: readonly [string, readonly string[]][] = [
      [
        "sourceExportRefs",
        value.sourceExportRefs.map((entry) => jcsCanonicalize(entry))
      ],
      ["sourceArtifactHashes", value.sourceArtifactHashes],
      ["reasonCodes", value.reasonCodes],
      [
        "acceptedClaims",
        value.acceptedClaims.map((entry) => entry.claimId)
      ],
      [
        "fieldEvidence",
        value.fieldEvidence.map((entry) => entry.fieldEvidenceId)
      ],
      [
        "rejectedClaims",
        value.rejectedClaims.map((entry) => entry.rejectedClaimId)
      ],
      [
        "conflictingClaims",
        value.conflictingClaims.map((entry) => entry.conflictId)
      ]
    ];
    for (const [path, keys] of canonicalCollections) {
      if (!isSortedUnique(keys, compareStrings)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must be sorted and unique`
        });
      }
    }
    const evidenceById = new Map(
      value.fieldEvidence.map((entry) => [entry.fieldEvidenceId, entry])
    );
    if (evidenceById.size !== value.acceptedClaims.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fieldEvidence"],
        message: "Accepted claims and field evidence must be a one-to-one set"
      });
    }
    for (const claim of value.acceptedClaims) {
      const evidence = evidenceById.get(claim.fieldEvidenceId);
      if (
        !evidence ||
        evidence.claimId !== claim.claimId ||
        evidence.outputFieldPath !== claim.outputFieldPath
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptedClaims"],
          message: "Accepted claim lineage must match exactly one field evidence item"
        });
      }
    }
    const acceptedClaimIds = new Set(
      value.acceptedClaims.map((claim) => claim.claimId)
    );
    const windowDurationMs =
      Date.parse(value.captureWindow.end) - Date.parse(value.captureWindow.start);
    const requiredLeafPaths: string[] = [];
    const semanticClaimIds = new Set<string>();
    for (const [itemIndex, item] of value.semanticOutput.items.entries()) {
      requiredLeafPaths.push(
        `/items/${itemIndex}/title`,
        `/items/${itemIndex}/summary`
      );
      item.caveatCodes.forEach((_code, caveatIndex) => {
        requiredLeafPaths.push(`/items/${itemIndex}/caveatCodes/${caveatIndex}`);
      });
      for (const claimId of item.claimIds) {
        if (semanticClaimIds.has(claimId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["semanticOutput", "items", itemIndex, "claimIds"],
            message: "A semantic claim ID may occur on exactly one item"
          });
        }
        semanticClaimIds.add(claimId);
        const claim = value.acceptedClaims.find(
          (candidate) => candidate.claimId === claimId
        );
        if (!claim || !claim.outputFieldPath.startsWith(`/items/${itemIndex}/`)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["semanticOutput", "items", itemIndex, "claimIds"],
            message: "Semantic claim IDs must resolve to a leaf on the same item"
          });
        }
      }
    }
    const acceptedPaths = value.acceptedClaims.map(
      (claim) => claim.outputFieldPath
    );
    if (
      requiredLeafPaths.length !== acceptedPaths.length ||
      requiredLeafPaths.some(
        (path) => acceptedPaths.filter((candidate) => candidate === path).length !== 1
      ) ||
      acceptedClaimIds.size !== semanticClaimIds.size ||
      [...acceptedClaimIds].some((claimId) => !semanticClaimIds.has(claimId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticOutput"],
        message: "Semantic leaves, accepted claims, and item claim IDs must be exact bijections"
      });
    }
    const rejectedClaimsById = new Map(
      value.rejectedClaims.map((claim) => [claim.rejectedClaimId, claim])
    );
    if (
      value.rejectedClaims.some((claim) =>
        acceptedClaimIds.has(claim.rejectedClaimId)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectedClaims"],
        message: "Accepted and rejected claim IDs must be globally disjoint"
      });
    }
    const resolvedConflictClaimIds = new Set<string>();
    const conflictedOutputPaths = new Set<string>();
    for (const [conflictIndex, conflict] of value.conflictingClaims.entries()) {
      conflictedOutputPaths.add(conflict.outputFieldPath);
      for (const screenClaimId of conflict.screenClaimIds) {
        const rejectedClaim = rejectedClaimsById.get(screenClaimId);
        if (
          !rejectedClaim ||
          rejectedClaim.proposedOutputFieldPath !== conflict.outputFieldPath ||
          rejectedClaim.reasonCode !== "STRUCTURED_AUTHORITY_CONFLICT"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["conflictingClaims", conflictIndex, "screenClaimIds"],
            message: "Conflict screen claim IDs must resolve to matching rejected claims"
          });
        }
        if (
          acceptedClaimIds.has(screenClaimId) ||
          semanticClaimIds.has(screenClaimId) ||
          resolvedConflictClaimIds.has(screenClaimId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["conflictingClaims", conflictIndex, "screenClaimIds"],
            message: "Conflict screen claim IDs must be rejected-only and globally unique"
          });
        }
        resolvedConflictClaimIds.add(screenClaimId);
      }
    }
    for (const acceptedClaim of value.acceptedClaims) {
      if (conflictedOutputPaths.has(acceptedClaim.outputFieldPath)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptedClaims"],
          message: "A conflicted output path cannot emit an accepted screen claim"
        });
      }
    }
    for (const rejectedClaim of value.rejectedClaims) {
      if (
        rejectedClaim.reasonCode === "STRUCTURED_AUTHORITY_CONFLICT" &&
        !resolvedConflictClaimIds.has(rejectedClaim.rejectedClaimId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rejectedClaims"],
          message: "Every structured-conflict rejection must resolve to one conflict record"
        });
      }
    }
    for (const evidence of value.fieldEvidence) {
      if (!acceptedClaimIds.has(evidence.claimId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fieldEvidence"],
          message: "Field evidence cannot exist without its accepted claim"
        });
      }
      for (const source of evidence.sourceArtifactRefs) {
        if (!value.sourceArtifactHashes.includes(source.blobSha256)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fieldEvidence"],
            message: "Field lineage may reference only normalized source artifact hashes"
          });
        }
      }
      for (const span of evidence.captureSpans) {
        if (
          span.spanKind === "normalized_frame" &&
          span.endOffsetMs > windowDurationMs
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fieldEvidence"],
            message: "Frame capture span exceeds the normalized capture window"
          });
        }
      }
    }
    if (
      value.coverageCode === "failure" &&
      (value.acceptedClaims.length > 0 || value.fieldEvidence.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedClaims"],
        message: "Failure coverage cannot emit evidence claims"
      });
    }
    if (!verifyRegisteredArtifactHash("normalized-screen-evidence", value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayflowNormalizedEvidenceHash"],
        message: "Normalized evidence hash mismatch"
      });
    }
  });

export const normalizedEvidenceSchema = dayflowNormalizedEvidenceSchema;

export type DayflowNormalizedEvidence = z.infer<
  typeof dayflowNormalizedEvidenceSchema
>;

export function dayflowNormalizedEvidenceSha256(
  value: Omit<DayflowNormalizedEvidence, "dayflowNormalizedEvidenceHash">
): string {
  return domainSeparatedSha256(
    "blabase.dayflow-normalized-evidence.v0.1",
    value
  );
}

export const resolvedNormalizedEvidenceIssueCodeSchema = z.enum([
  "NORMALIZED_EVIDENCE_INVALID",
  "EXPORT_MANIFEST_MAP_NOT_EXACT",
  "SOURCE_ARTIFACT_MAP_NOT_EXACT",
  "ARTIFACT_BLOB_MAP_NOT_EXACT",
  "ARTIFACT_BLOB_BYTES_MISMATCH",
  "EXPORT_REFERENCE_MISMATCH",
  "EXPORT_ARTIFACT_OWNERSHIP_MISMATCH",
  "ORIGIN_PHASE_PROTOCOL_MISMATCH",
  "CAPTURE_WINDOW_MISMATCH",
  "NORMALIZED_TEXT_MAP_NOT_EXACT",
  "NORMALIZED_TEXT_HASH_MISMATCH",
  "NORMALIZED_TEXT_LENGTH_MISMATCH",
  "UTF8_TEXT_INVALID",
  "UTF8_SPAN_OUT_OF_BOUNDS",
  "UTF8_SPAN_NOT_BOUNDARY"
]);

export type ResolvedNormalizedEvidenceIssueCode = z.infer<
  typeof resolvedNormalizedEvidenceIssueCodeSchema
>;

export type ResolvedExportArtifact = Readonly<{
  sourceArtifactRef: SourceArtifactRef;
  exportManifest: DayflowScreenEvidenceExport;
  artifact: DayflowExportArtifact;
}>;

export type ResolvedArtifactBlob = Readonly<{
  sourceArtifactId: string;
  bytes: Uint8Array;
}>;

export type ResolvedNormalizedText = Readonly<{
  sourceArtifactRef: SourceArtifactRef;
  normalizedTextSha256: string;
  byteLength: string;
  utf8Bytes: Uint8Array;
}>;

export type ResolvedNormalizedEvidenceVerification =
  | Readonly<{
      valid: true;
      evidence: DayflowNormalizedEvidence;
      issueCodes: readonly [];
    }>
  | Readonly<{
      valid: false;
      issueCodes: readonly ResolvedNormalizedEvidenceIssueCode[];
    }>;

function hasExactUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, offset));
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(offset));
    return true;
  } catch {
    return false;
  }
}

function normalizedTextResolutionKey(
  sourceArtifactRef: SourceArtifactRef,
  normalizedTextSha256: string
): string {
  return jcsCanonicalize({ sourceArtifactRef, normalizedTextSha256 });
}

/**
 * Resolves normalized lineage against exact immutable export/artifact owners
 * and exact normalized UTF-8 resources. This performs no extraction and has no
 * filesystem, network, external-service, or production-store capability.
 */
export function verifyResolvedNormalizedEvidence(input: Readonly<{
  evidence: unknown;
  resolvedExportManifests: readonly DayflowScreenEvidenceExport[];
  resolvedArtifacts: readonly ResolvedExportArtifact[];
  artifactBlobs: readonly ResolvedArtifactBlob[];
  normalizedTexts: readonly ResolvedNormalizedText[];
}>): ResolvedNormalizedEvidenceVerification {
  const parsed = dayflowNormalizedEvidenceSchema.safeParse(input.evidence);
  if (!parsed.success) {
    return { valid: false, issueCodes: ["NORMALIZED_EVIDENCE_INVALID"] };
  }
  const evidence = parsed.data;
  const issueCodes = new Set<ResolvedNormalizedEvidenceIssueCode>();
  const requiredSourceRefs = new Map<string, SourceArtifactRef>();
  const requiredExportRefs = new Map<
    string,
    SourceArtifactRef["exportRef"]
  >(
    evidence.sourceExportRefs.map((exportRef) => [
      jcsCanonicalize(exportRef),
      exportRef
    ])
  );
  const declaredExportRefKeys = new Set(requiredExportRefs.keys());
  const rememberSourceRef = (sourceRef: SourceArtifactRef): void => {
    requiredSourceRefs.set(jcsCanonicalize(sourceRef), sourceRef);
    requiredExportRefs.set(
      jcsCanonicalize(sourceRef.exportRef),
      sourceRef.exportRef
    );
  };
  for (const fieldEvidence of evidence.fieldEvidence) {
    for (const sourceRef of fieldEvidence.sourceArtifactRefs) {
      rememberSourceRef(sourceRef);
    }
    for (const span of fieldEvidence.captureSpans) {
      rememberSourceRef(span.sourceArtifactRef);
    }
  }
  for (const rejectedClaim of evidence.rejectedClaims) {
    for (const sourceRef of rejectedClaim.sourceArtifactRefs) {
      rememberSourceRef(sourceRef);
    }
  }
  if (
    requiredExportRefs.size !== declaredExportRefKeys.size ||
    [...requiredExportRefs.keys()].some(
      (key) => !declaredExportRefKeys.has(key)
    )
  ) {
    issueCodes.add("EXPORT_MANIFEST_MAP_NOT_EXACT");
  }

  const exportManifestsByRef = new Map<
    string,
    DayflowScreenEvidenceExport
  >();
  for (const candidate of input.resolvedExportManifests) {
    const manifest = dayflowScreenEvidenceExportSchema.safeParse(candidate);
    if (!manifest.success) {
      issueCodes.add("EXPORT_MANIFEST_MAP_NOT_EXACT");
      continue;
    }
    const exportRef = {
      schemaVersion: manifest.data.schemaVersion,
      exportId: manifest.data.exportId,
      detachedManifestSha256: manifest.data.detachedManifestSha256
    };
    const key = jcsCanonicalize(exportRef);
    if (exportManifestsByRef.has(key)) {
      issueCodes.add("EXPORT_MANIFEST_MAP_NOT_EXACT");
    }
    exportManifestsByRef.set(key, manifest.data);
    if (
      manifest.data.dataOrigin !== evidence.dataOrigin ||
      manifest.data.studyPhase !== evidence.studyPhase ||
      manifest.data.studyProtocolHash !== evidence.studyProtocolHash
    ) {
      issueCodes.add("ORIGIN_PHASE_PROTOCOL_MISMATCH");
    }
    if (
      manifest.data.windowStart !== evidence.captureWindow.start ||
      manifest.data.windowEnd !== evidence.captureWindow.end ||
      jcsCanonicalize(manifest.data.coverage) !==
        jcsCanonicalize(evidence.normalizedCoverage) ||
      classifyDayflowCoverage({
        coverage: manifest.data.coverage,
        artifacts: manifest.data.artifacts
      }) !== evidence.coverageCode
    ) {
      issueCodes.add("CAPTURE_WINDOW_MISMATCH");
    }
  }
  const exactExportMap =
    exportManifestsByRef.size === input.resolvedExportManifests.length &&
    exportManifestsByRef.size === declaredExportRefKeys.size &&
    [...declaredExportRefKeys].every((key) =>
      exportManifestsByRef.has(key)
    ) &&
    [...exportManifestsByRef.keys()].every((key) =>
      declaredExportRefKeys.has(key)
    ) &&
    (requiredSourceRefs.size > 0 ||
      (evidence.sourceArtifactHashes.length === 0 &&
        [...exportManifestsByRef.values()].every(
          (manifest) => manifest.artifacts.length === 0
        )));
  if (!exactExportMap) {
    issueCodes.add("EXPORT_MANIFEST_MAP_NOT_EXACT");
  }

  const resolvedByRef = new Map<string, ResolvedExportArtifact>();
  const resolvedByArtifactId = new Map<string, DayflowExportArtifact>();
  const resolvedBlobHashes = new Set<string>();
  for (const resolved of input.resolvedArtifacts) {
    const sourceRef = sourceArtifactRefSchema.safeParse(
      resolved.sourceArtifactRef
    );
    const artifact = dayflowExportArtifactSchema.safeParse(resolved.artifact);
    if (!sourceRef.success || !artifact.success) {
      issueCodes.add("SOURCE_ARTIFACT_MAP_NOT_EXACT");
      issueCodes.add("EXPORT_ARTIFACT_OWNERSHIP_MISMATCH");
      continue;
    }
    const refKey = jcsCanonicalize(sourceRef.data);
    if (
      resolvedByRef.has(refKey) ||
      resolvedByArtifactId.has(artifact.data.sourceArtifactId)
    ) {
      issueCodes.add("SOURCE_ARTIFACT_MAP_NOT_EXACT");
    }
    resolvedByRef.set(refKey, resolved);
    resolvedByArtifactId.set(artifact.data.sourceArtifactId, artifact.data);
    resolvedBlobHashes.add(artifact.data.sha256);

    const manifest = dayflowScreenEvidenceExportSchema.safeParse(
      resolved.exportManifest
    );
    const resolvedExportKey = manifest.success
      ? jcsCanonicalize({
          schemaVersion: manifest.data.schemaVersion,
          exportId: manifest.data.exportId,
          detachedManifestSha256: manifest.data.detachedManifestSha256
        })
      : undefined;
    const registeredManifest =
      resolvedExportKey === undefined
        ? undefined
        : exportManifestsByRef.get(resolvedExportKey);
    if (
      !manifest.success ||
      registeredManifest === undefined ||
      jcsCanonicalize(registeredManifest) !== jcsCanonicalize(manifest.data) ||
      sourceRef.data.exportRef.exportId !== manifest.data.exportId ||
      sourceRef.data.exportRef.detachedManifestSha256 !==
        manifest.data.detachedManifestSha256
    ) {
      issueCodes.add("EXPORT_REFERENCE_MISMATCH");
      continue;
    }
    if (
      manifest.data.dataOrigin !== evidence.dataOrigin ||
      manifest.data.studyPhase !== evidence.studyPhase ||
      manifest.data.studyProtocolHash !== evidence.studyProtocolHash
    ) {
      issueCodes.add("ORIGIN_PHASE_PROTOCOL_MISMATCH");
    }
    if (
      manifest.data.windowStart !== evidence.captureWindow.start ||
      manifest.data.windowEnd !== evidence.captureWindow.end
    ) {
      issueCodes.add("CAPTURE_WINDOW_MISMATCH");
    }
    const owners = manifest.data.artifacts.filter(
      (candidate) =>
        candidate.sourceArtifactId === artifact.data.sourceArtifactId
    );
    const referenceOwners = manifest.data.artifacts.filter(
      (candidate) =>
        candidate.sourceRowId === sourceRef.data.sourceRowId &&
        candidate.sha256 === sourceRef.data.blobSha256
    );
    if (
      owners.length !== 1 ||
      referenceOwners.length !== 1 ||
      artifact.data.sourceRowId !== sourceRef.data.sourceRowId ||
      artifact.data.sha256 !== sourceRef.data.blobSha256 ||
      jcsCanonicalize(referenceOwners[0]!) !==
        jcsCanonicalize(artifact.data) ||
      jcsCanonicalize(owners[0]!) !== jcsCanonicalize(artifact.data)
    ) {
      issueCodes.add("EXPORT_ARTIFACT_OWNERSHIP_MISMATCH");
    }
  }

  if (
    resolvedByRef.size !== input.resolvedArtifacts.length ||
    resolvedByRef.size !== requiredSourceRefs.size ||
    resolvedByArtifactId.size !== input.resolvedArtifacts.length ||
    resolvedBlobHashes.size !== evidence.sourceArtifactHashes.length ||
    evidence.sourceArtifactHashes.some((hash) => !resolvedBlobHashes.has(hash)) ||
    [...requiredSourceRefs.keys()].some((key) => !resolvedByRef.has(key)) ||
    [...resolvedByRef.keys()].some((key) => !requiredSourceRefs.has(key))
  ) {
    issueCodes.add("SOURCE_ARTIFACT_MAP_NOT_EXACT");
  }

  const blobsByArtifactId = new Map<string, ResolvedArtifactBlob>();
  for (const blob of input.artifactBlobs) {
    const validId = identifierSchema.safeParse(blob.sourceArtifactId).success;
    const resolvedArtifact = resolvedByArtifactId.get(blob.sourceArtifactId);
    if (
      !validId ||
      !(blob.bytes instanceof Uint8Array) ||
      blobsByArtifactId.has(blob.sourceArtifactId) ||
      resolvedArtifact === undefined
    ) {
      issueCodes.add("ARTIFACT_BLOB_MAP_NOT_EXACT");
      continue;
    }
    blobsByArtifactId.set(blob.sourceArtifactId, blob);
    if (!verifyArtifactBlobBytes(resolvedArtifact, blob.bytes)) {
      issueCodes.add("ARTIFACT_BLOB_BYTES_MISMATCH");
    }
  }
  if (
    blobsByArtifactId.size !== input.artifactBlobs.length ||
    blobsByArtifactId.size !== resolvedByArtifactId.size ||
    [...resolvedByArtifactId.keys()].some(
      (artifactId) => !blobsByArtifactId.has(artifactId)
    ) ||
    [...blobsByArtifactId.keys()].some(
      (artifactId) => !resolvedByArtifactId.has(artifactId)
    )
  ) {
    issueCodes.add("ARTIFACT_BLOB_MAP_NOT_EXACT");
  }

  const textSpans = evidence.fieldEvidence.flatMap((fieldEvidence) =>
    fieldEvidence.captureSpans.filter(
      (span): span is z.infer<typeof textOffsetUtf8SpanSchema> =>
        span.spanKind === "text_offset_utf8"
    )
  );
  const expectedTextKeys = new Set(
    textSpans.map((span) =>
      normalizedTextResolutionKey(
        span.sourceArtifactRef,
        span.normalizedTextSha256
      )
    )
  );
  const textsByKey = new Map<string, ResolvedNormalizedText>();
  for (const text of input.normalizedTexts) {
    const sourceRef = sourceArtifactRefSchema.safeParse(text.sourceArtifactRef);
    if (!sourceRef.success) {
      issueCodes.add("NORMALIZED_TEXT_MAP_NOT_EXACT");
      continue;
    }
    const textKey = normalizedTextResolutionKey(
      sourceRef.data,
      text.normalizedTextSha256
    );
    if (
      textsByKey.has(textKey) ||
      !expectedTextKeys.has(textKey)
    ) {
      issueCodes.add("NORMALIZED_TEXT_MAP_NOT_EXACT");
    }
    textsByKey.set(textKey, text);
    if (canonicalDecimalSchema.safeParse(text.byteLength).success === false) {
      issueCodes.add("NORMALIZED_TEXT_LENGTH_MISMATCH");
    } else if (BigInt(text.byteLength) !== BigInt(text.utf8Bytes.byteLength)) {
      issueCodes.add("NORMALIZED_TEXT_LENGTH_MISMATCH");
    }
    if (
      createHash("sha256").update(text.utf8Bytes).digest("hex") !==
      text.normalizedTextSha256
    ) {
      issueCodes.add("NORMALIZED_TEXT_HASH_MISMATCH");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(text.utf8Bytes);
    } catch {
      issueCodes.add("UTF8_TEXT_INVALID");
    }
  }
  if (
    textsByKey.size !== expectedTextKeys.size ||
    [...expectedTextKeys].some((key) => !textsByKey.has(key))
  ) {
    issueCodes.add("NORMALIZED_TEXT_MAP_NOT_EXACT");
  }
  for (const span of textSpans) {
    const text = textsByKey.get(
      normalizedTextResolutionKey(
        span.sourceArtifactRef,
        span.normalizedTextSha256
      )
    );
    if (!text) continue;
    if (
      span.startByteOffset < 0 ||
      span.endByteOffset > text.utf8Bytes.byteLength ||
      span.startByteOffset >= span.endByteOffset
    ) {
      issueCodes.add("UTF8_SPAN_OUT_OF_BOUNDS");
      continue;
    }
    if (
      !hasExactUtf8Boundary(text.utf8Bytes, span.startByteOffset) ||
      !hasExactUtf8Boundary(text.utf8Bytes, span.endByteOffset)
    ) {
      issueCodes.add("UTF8_SPAN_NOT_BOUNDARY");
    }
  }

  if (issueCodes.size > 0) {
    return {
      valid: false,
      issueCodes: [...issueCodes].sort(compareStrings)
    };
  }
  return { valid: true, evidence, issueCodes: [] };
}
