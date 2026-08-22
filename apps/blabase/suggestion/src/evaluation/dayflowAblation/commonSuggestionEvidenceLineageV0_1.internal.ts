import { Buffer } from "node:buffer";
import { types as nodeUtilTypes } from "node:util";

import { z } from "zod";

import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../../dayflowEvidence/contracts";

export const RECEIPT_SCHEMA_VERSION_V0_1 =
  "blabase-common-suggestion-evidence-lineage-receipt-v0.1" as const;
export const RECEIPT_HASH_DOMAIN_V0_1 =
  "blabase.common-suggestion-evidence-lineage-receipt.v0.1" as const;
export const SOURCE_ATTESTATION_SCHEMA_VERSION_V0_1 =
  "blabase-common-suggestion-source-collection-attestation-v0.1" as const;
export const SOURCE_ATTESTATION_HASH_DOMAIN_V0_1 =
  "blabase.common-suggestion-source-collection-attestation.v0.1" as const;
export const RECORD_ID_SET_HASH_DOMAIN_V0_1 =
  "blabase.common-suggestion-evidence-lineage-record-ids.v0.1" as const;
export const PRIVATE_SCOPE_HMAC_DOMAIN_V0_1 =
  "blabase.lineage.private-scope.v0.1" as const;
export const SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1 =
  "blabase-scope-token-canonicalization-v0.1" as const;
export const TIMEZONE_PROFILE_VERSION_V0_1 =
  "blabase-tzdb-profile-2026c-v1" as const;
export const TIMEZONE_RELEASE_VERSION_V0_1 = "2026c" as const;
export const TIMEZONE_RELEASE_SHA512_V0_1 =
  "e0b4b7044b66fbc27bc21d13d18063abcdf78ab58d5ba5fd64bd1a88d86e9d495f45add4d8e65bb6c40249f9c94ca29b72c8ebba8d0e4c468f2965ac77932ef0" as const;

export const LINEAGE_LIMITS_V0_1 = Object.freeze({
  maximumCanonicalReceiptBytes: 262_144,
  maximumCanonicalSourceAttestationBytes: 131_072,
  maximumPrivateScopeHmacPreimageBytes: 1_048_576,
  maximumSourceBindings: 5,
  maximumCoverageIntervalsPerBinding: 1_024,
  maximumNeutralIssueCodesPerBinding: 32,
  maximumInputGraphDepth: 32,
  maximumEnumerableOwnProperties: 16_384,
  maximumCanonicalTokens: 4_096,
  maximumCanonicalTokenUtf8Bytes: 2_048,
});

export const LINEAGE_SOURCES_V0_1 = Object.freeze([
  "github",
  "codex",
  "google_calendar",
  "notion",
  "dayflow",
] as const);

export type LineageSourceV0_1 = (typeof LINEAGE_SOURCES_V0_1)[number];
export type LineageFailureCodeV0_1 =
  | "INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "RECORD_SET_BINDING_MISMATCH"
  | "SOURCE_BINDING_INVALID"
  | "SOURCE_ATTESTATION_INVALID"
  | "SOURCE_ATTESTATION_BINDING_MISMATCH"
  | "SOURCE_VERIFIER_UNAVAILABLE"
  | "PRIVACY_SCOPE_DIGEST_INVALID"
  | "PRIVACY_SCOPE_KEY_UNAVAILABLE"
  | "PRIVACY_SCOPE_CONTEXT_INVALID"
  | "SCOPE_TOKEN_CANONICALIZATION_INVALID"
  | "TIMEZONE_PROFILE_INVALID"
  | "RECORD_ID_SET_MISMATCH"
  | "COVERAGE_INVALID"
  | "HASH_MISMATCH";

export type LineageVerificationStageV0_1 =
  | "intrinsic_receipt"
  | "record_set_binding"
  | "source_attestation";

const FAILURE_PRECEDENCE_V0_1 = Object.freeze({
  intrinsic_receipt: Object.freeze([
    "RESOURCE_LIMIT_EXCEEDED",
    "INPUT_INVALID",
    "SOURCE_BINDING_INVALID",
    "HASH_MISMATCH",
  ] as const),
  record_set_binding: Object.freeze([
    "RESOURCE_LIMIT_EXCEEDED",
    "INPUT_INVALID",
    "HASH_MISMATCH",
    "RECORD_SET_BINDING_MISMATCH",
    "RECORD_ID_SET_MISMATCH",
  ] as const),
  source_attestation: Object.freeze([
    "RESOURCE_LIMIT_EXCEEDED",
    "INPUT_INVALID",
    "SOURCE_BINDING_INVALID",
    "SOURCE_ATTESTATION_INVALID",
    "HASH_MISMATCH",
    "SOURCE_VERIFIER_UNAVAILABLE",
    "PRIVACY_SCOPE_CONTEXT_INVALID",
    "PRIVACY_SCOPE_KEY_UNAVAILABLE",
    "SCOPE_TOKEN_CANONICALIZATION_INVALID",
    "PRIVACY_SCOPE_DIGEST_INVALID",
    "TIMEZONE_PROFILE_INVALID",
    "SOURCE_ATTESTATION_BINDING_MISMATCH",
    "RECORD_ID_SET_MISMATCH",
    "COVERAGE_INVALID",
  ] as const),
});

export function selectLineageFailureCodeInternalV0_1(
  stage: LineageVerificationStageV0_1,
  candidates: ReadonlySet<LineageFailureCodeV0_1>,
): LineageFailureCodeV0_1 | null {
  const precedence = FAILURE_PRECEDENCE_V0_1[stage];
  for (let index = 0; index < precedence.length; index += 1) {
    const failureCode = precedence[index]!;
    if (applyIntrinsic<boolean>(intrinsicSetHas, candidates, [failureCode])) {
      return failureCode;
    }
  }
  return null;
}

const intrinsicReflectApply = Reflect.apply;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const IntrinsicString = String;
const IntrinsicTypeError = TypeError;
const IntrinsicDate = Date;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicWeakSet = WeakSet;
const intrinsicDateParse = Date.parse;
const intrinsicDateToISOString = Date.prototype.toISOString;
const intrinsicTextEncoderEncode = TextEncoder.prototype.encode;
const intrinsicRegExpTest = RegExp.prototype.test;
const intrinsicStringSplit = String.prototype.split;
const intrinsicStringNormalize = String.prototype.normalize;
const intrinsicStringStartsWith = String.prototype.startsWith;
const intrinsicStringEndsWith = String.prototype.endsWith;
const intrinsicStringIncludes = String.prototype.includes;
const intrinsicStringSlice = String.prototype.slice;
const intrinsicStringToLowerCase = String.prototype.toLowerCase;
const intrinsicStringReplaceAll = String.prototype.replaceAll;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicArrayEvery = Array.prototype.every;
const intrinsicArraySome = Array.prototype.some;
const intrinsicArrayMap = Array.prototype.map;
const intrinsicArrayIncludes = Array.prototype.includes;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicArraySort = Array.prototype.sort;
const intrinsicArraySlice = Array.prototype.slice;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicObjectIs = Object.is;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectHasOwnProperty = Object.prototype.hasOwnProperty;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicSetHas = Set.prototype.has;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const intrinsicNodeIsProxy = nodeUtilTypes.isProxy;
const intrinsicNodeIsUint8Array = nodeUtilTypes.isUint8Array;
const intrinsicBufferFrom = Buffer.from;
const intrinsicBufferToString = Buffer.prototype.toString;
const typedArrayPrototype = intrinsicObjectGetPrototypeOf(Uint8Array.prototype);
const intrinsicTypedArrayByteLengthGetter =
  intrinsicObjectGetOwnPropertyDescriptor(
    typedArrayPrototype,
    "byteLength",
  )?.get;
const intrinsicUint8ArrayFill = Uint8Array.prototype.fill;

function applyIntrinsic<T>(
  target: (...args: never[]) => unknown,
  receiver: unknown,
  args: readonly unknown[],
): T {
  return intrinsicReflectApply(target, receiver, args) as T;
}

function freezeObject<T extends object>(value: T): T {
  return applyIntrinsic<T>(intrinsicObjectFreeze, Object, [value]);
}

function objectHasOwn(value: object, key: PropertyKey): boolean {
  return applyIntrinsic<boolean>(intrinsicObjectHasOwnProperty, value, [key]);
}

function objectIsFrozen(value: object): boolean {
  return applyIntrinsic<boolean>(intrinsicObjectIsFrozen, Object, [value]);
}

function reflectOwnKeys(value: object): readonly PropertyKey[] {
  return applyIntrinsic<readonly PropertyKey[]>(intrinsicReflectOwnKeys, Reflect, [
    value,
  ]);
}

function textEncode(value: string): Uint8Array {
  return applyIntrinsic<Uint8Array>(intrinsicTextEncoderEncode, utf8Encoder, [
    value,
  ]);
}

function typedArrayByteLength(value: Uint8Array): number {
  if (intrinsicTypedArrayByteLengthGetter === undefined) {
    throw new IntrinsicTypeError("Typed-array byteLength intrinsic unavailable");
  }
  return applyIntrinsic<number>(intrinsicTypedArrayByteLengthGetter, value, []);
}

function fillUint8Array(value: Uint8Array, byte: number): void {
  applyIntrinsic<Uint8Array>(intrinsicUint8ArrayFill, value, [byte]);
}

function isNodeProxy(value: object): boolean {
  return applyIntrinsic<boolean>(intrinsicNodeIsProxy, nodeUtilTypes, [value]);
}

function isNodeUint8Array(value: unknown): value is Uint8Array {
  return applyIntrinsic<boolean>(intrinsicNodeIsUint8Array, nodeUtilTypes, [
    value,
  ]);
}

function weakSetHas(seen: WeakSet<object>, value: object): boolean {
  return applyIntrinsic<boolean>(intrinsicWeakSetHas, seen, [value]);
}

function weakSetAdd(seen: WeakSet<object>, value: object): void {
  applyIntrinsic<WeakSet<object>>(intrinsicWeakSetAdd, seen, [value]);
}

function regexTest(pattern: RegExp, value: string): boolean {
  return applyIntrinsic<boolean>(intrinsicRegExpTest, pattern, [value]);
}

function stringSplit(value: string, separator: string): string[] {
  return applyIntrinsic<string[]>(intrinsicStringSplit, value, [separator]);
}

function stringNormalize(value: string): string {
  return applyIntrinsic<string>(intrinsicStringNormalize, value, ["NFC"]);
}

function stringStartsWith(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(intrinsicStringStartsWith, value, [search]);
}

function stringEndsWith(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(intrinsicStringEndsWith, value, [search]);
}

function stringIncludes(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(intrinsicStringIncludes, value, [search]);
}

function stringSlice(value: string, start: number, end?: number): string {
  return applyIntrinsic<string>(
    intrinsicStringSlice,
    value,
    end === undefined ? [start] : [start, end],
  );
}

function stringToLowerCase(value: string): string {
  return applyIntrinsic<string>(intrinsicStringToLowerCase, value, []);
}

function stringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  return applyIntrinsic<string>(intrinsicStringReplaceAll, value, [
    search,
    replacement,
  ]);
}

function arrayEvery<T>(
  values: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => boolean,
): boolean {
  return applyIntrinsic<boolean>(intrinsicArrayEvery, values, [predicate]);
}

function arraySome<T>(
  values: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => boolean,
): boolean {
  return applyIntrinsic<boolean>(intrinsicArraySome, values, [predicate]);
}

function arrayMap<T, U>(
  values: readonly T[],
  mapper: (value: T, index: number, array: readonly T[]) => U,
): U[] {
  return applyIntrinsic<U[]>(intrinsicArrayMap, values, [mapper]);
}

function arrayIncludes<T>(values: readonly T[], search: T): boolean {
  return applyIntrinsic<boolean>(intrinsicArrayIncludes, values, [search]);
}

function arrayPushValue<T>(values: T[], value: T): void {
  applyIntrinsic<number>(intrinsicArrayPush, values, [value]);
}

function arraySortStrings(values: string[]): string[] {
  return applyIntrinsic<string[]>(intrinsicArraySort, values, []);
}

function arraySlice<T>(values: readonly T[], start: number): T[] {
  return applyIntrinsic<T[]>(intrinsicArraySlice, values, [start]);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const TIMESTAMP_PATTERN =
  /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const BOUNDED_IDENTIFIER_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const BOUNDED_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const BOUNDED_OPAQUE_VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CONTEXT_ID_PATTERN = /^scope_context_[0-9a-f]{32}$/u;
const LOWERCASE_SOURCE_VALUE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const PRINTABLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;

const sourceSchema = z.enum(LINEAGE_SOURCES_V0_1);
const sha256Schema = z.string().refine((value) => regexTest(SHA256_PATTERN, value));
const sha512Schema = z.string().refine((value) => regexTest(SHA512_PATTERN, value));
const timestampSchema = z
  .string()
  .refine((value) => regexTest(TIMESTAMP_PATTERN, value))
  .refine((value) => {
    const epoch = applyIntrinsic<number>(intrinsicDateParse, IntrinsicDate, [
      value,
    ]);
    if (!applyIntrinsic<boolean>(intrinsicNumberIsFinite, Number, [epoch])) {
      return false;
    }
    const date = new IntrinsicDate(epoch);
    return (
      applyIntrinsic<string>(intrinsicDateToISOString, date, []) === value
    );
  });
const boundedIdentifierSchema = z
  .string()
  .refine((value) => regexTest(BOUNDED_IDENTIFIER_PATTERN, value));
const boundedVersionSchema = z
  .string()
  .refine((value) => regexTest(BOUNDED_VERSION_PATTERN, value));
const boundedOpaqueVersionSchema = z
  .string()
  .refine((value) => regexTest(BOUNDED_OPAQUE_VERSION_PATTERN, value));
const contextIdSchema = z
  .string()
  .refine((value) => regexTest(CONTEXT_ID_PATTERN, value));
const unsignedIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0));

const intervalSchema = z
  .object({ start: timestampSchema, end: timestampSchema })
  .strict()
  .refine((interval) => interval.start < interval.end);
const coveredIntervalsSchema = z
  .array(intervalSchema)
  .max(LINEAGE_LIMITS_V0_1.maximumCoverageIntervalsPerBinding)
  .refine((intervals) => {
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (!previous || !current || previous.end >= current.start) return false;
    }
    return true;
  });

const issueCodeSchema = z.enum([
  "SOURCE_UNAVAILABLE",
  "COVERAGE_UNKNOWN",
  "SCOPE_PARTIAL",
  "PAGINATION_INCOMPLETE",
  "WINDOW_GAP",
  "COLLECTION_PARTIAL",
  "PREPROCESSING_PARTIAL",
  "UPSTREAM_ERROR_REPORTED",
]);
const issueCodesSchema = z
  .array(issueCodeSchema)
  .max(LINEAGE_LIMITS_V0_1.maximumNeutralIssueCodesPerBinding)
  .refine(isSortedUniqueAscii);

const requestedCollectionModeSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => regexTest(LOWERCASE_SOURCE_VALUE_PATTERN, value))
  .nullable();
const operationNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => regexTest(LOWERCASE_SOURCE_VALUE_PATTERN, value));
const operationStatusSchema = z
  .object({
    operation: operationNameSchema,
    status: z.enum(["complete", "partial", "unknown"]),
  })
  .strict();
const operationStatusesSchema = z.array(operationStatusSchema).max(2);

const collectionPlanEntrySchema = z
  .object({
    source: sourceSchema,
    requestStatus: z.enum(["requested", "not_requested"]),
    requestedCollectionMode: requestedCollectionModeSchema,
    requiredOperations: z.array(operationNameSchema).max(2),
  })
  .strict();

const notRequestedCoverageSchema = z
  .object({
    coverageKind: z.literal("not_requested"),
    status: z.literal("not_applicable"),
  })
  .strict();
const unavailableCoverageSchema = z
  .object({
    coverageKind: z.literal("unavailable"),
    status: z.literal("unknown"),
  })
  .strict();
const githubCoverageSchema = z
  .object({
    coverageKind: z.literal("github_scope"),
    status: z.enum(["complete", "partial", "unknown"]),
    requestedRepositoryScopeHmacSha256: sha256Schema,
    observedRepositoryScopeHmacSha256: sha256Schema.nullable(),
    paginationStatus: z.enum([
      "complete",
      "partial",
      "not_applicable",
      "unknown",
    ]),
    requestedActivityWindow: intervalSchema.nullable(),
    coveredActivityIntervals: coveredIntervalsSchema.nullable(),
  })
  .strict();
const codexCoverageSchema = z
  .object({
    coverageKind: z.literal("codex_collection"),
    status: z.enum(["complete", "partial", "unknown"]),
    requestedProjectScopeHmacSha256: sha256Schema,
    observedProjectScopeHmacSha256: sha256Schema.nullable(),
    conversationCollectionStatus: z.enum([
      "complete",
      "partial",
      "unavailable",
      "unknown",
    ]),
    requestedConversationWindow: intervalSchema,
    coveredConversationIntervals: coveredIntervalsSchema.nullable(),
  })
  .strict();
const timezoneContextSchema = z.union([
  z.literal("unknown"),
  z
    .string()
    .min(1)
    .max(255)
    .refine((value) => {
      if (!regexTest(PRINTABLE_ASCII_PATTERN, value)) return false;
      const components = stringSplit(value, "/");
      return arrayEvery(
        components,
        (component) => component !== "" && component !== "." && component !== "..",
      );
    }),
]);
const calendarCoverageSchema = z
  .object({
    coverageKind: z.literal("calendar_window"),
    status: z.enum(["complete", "partial", "unknown"]),
    requestedWindow: intervalSchema,
    coveredIntervals: coveredIntervalsSchema,
    timezoneDatabaseVersion: z.literal(TIMEZONE_RELEASE_VERSION_V0_1),
    timezoneDatabaseReleaseSha512: z.literal(
      TIMEZONE_RELEASE_SHA512_V0_1,
    ),
    timezoneDatabaseProfileVersion: z.literal(TIMEZONE_PROFILE_VERSION_V0_1),
    timezoneDatabaseProfileSha256: sha256Schema,
    timezoneContext: timezoneContextSchema,
  })
  .strict();
const notionCoverageSchema = z
  .object({
    coverageKind: z.literal("notion_resource_scope"),
    status: z.enum(["complete", "partial", "unknown"]),
    requestedResourceSetHmacSha256: sha256Schema,
    observedResourceSetHmacSha256: sha256Schema.nullable(),
    paginationStatus: z.enum([
      "complete",
      "partial",
      "not_applicable",
      "unknown",
    ]),
  })
  .strict();
const preprocessingAccountingSchema = z.union([
  z
    .object({
      accountingKind: z.literal("known"),
      eligibleCaptureCount: unsignedIntegerSchema,
      processedCaptureCount: unsignedIntegerSchema,
    })
    .strict()
    .refine(
      (accounting) =>
        accounting.processedCaptureCount <= accounting.eligibleCaptureCount,
    ),
  z.object({ accountingKind: z.literal("unknown") }).strict(),
]);
const dayflowCoverageSchema = z
  .object({
    coverageKind: z.literal("dayflow_capture_and_preprocessing"),
    status: z.enum(["complete", "partial", "unknown"]),
    captureCoverage: z
      .object({
        status: z.enum(["complete", "partial", "unknown"]),
        requestedWindow: intervalSchema,
        coveredIntervals: coveredIntervalsSchema,
        captureArtifactSetSha256: sha256Schema,
      })
      .strict(),
    preprocessingCoverage: z
      .object({
        status: z.enum(["complete", "partial", "unknown"]),
        inputCaptureArtifactSetSha256: sha256Schema,
        accounting: preprocessingAccountingSchema,
        preprocessingVersion: boundedVersionSchema,
        verifierVersion: boundedVersionSchema,
        preprocessingEvidenceSha256: sha256Schema,
      })
      .strict(),
  })
  .strict();

const coverageSchema = z.discriminatedUnion("coverageKind", [
  notRequestedCoverageSchema,
  unavailableCoverageSchema,
  githubCoverageSchema,
  codexCoverageSchema,
  calendarCoverageSchema,
  notionCoverageSchema,
  dayflowCoverageSchema,
]);

const sourceBindingSchema = z
  .object({
    source: sourceSchema,
    participationStatus: z.enum([
      "not_requested",
      "collected",
      "unavailable",
    ]),
    sourceCollectionAttestationSha256: sha256Schema.nullable(),
    sourceArtifactSetSha256: sha256Schema.nullable(),
    sourceArtifactSchemaVersion: boundedVersionSchema.nullable(),
    adapterId: boundedIdentifierSchema.nullable(),
    adapterVersion: boundedVersionSchema.nullable(),
    inputContractVersion: boundedVersionSchema.nullable(),
    collectedAt: timestampSchema.nullable(),
    recordCount: unsignedIntegerSchema,
    recordIdsSha256: sha256Schema,
    coverage: coverageSchema,
    requiredOperationStatuses: operationStatusesSchema,
    issueCodes: issueCodesSchema,
  })
  .strict();

const receiptSchemaInternalV0_1 = z
  .object({
    schemaVersion: z.literal(RECEIPT_SCHEMA_VERSION_V0_1),
    asOf: timestampSchema,
    commonSuggestionEvidenceRecordSetSha256: sha256Schema,
    privacyScopeHmacKeyVersion: boundedOpaqueVersionSchema.nullable(),
    privacyScopeHmacContextId: contextIdSchema.nullable(),
    privacyScopeTokenCanonicalizationVersion: z
      .literal(SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1)
      .nullable(),
    sourceCollectionPlan: z
      .array(collectionPlanEntrySchema)
      .length(LINEAGE_LIMITS_V0_1.maximumSourceBindings),
    sourceBindings: z
      .array(sourceBindingSchema)
      .length(LINEAGE_LIMITS_V0_1.maximumSourceBindings),
    commonSuggestionEvidenceLineageReceiptSha256: sha256Schema,
  })
  .strict();

export type CommonSuggestionEvidenceLineageReceiptV0_1 = z.infer<
  typeof receiptSchemaInternalV0_1
>;

const sourceAttestationSchemaInternalV0_1 = z
  .object({
    schemaVersion: z.literal(SOURCE_ATTESTATION_SCHEMA_VERSION_V0_1),
    source: sourceSchema,
    requestedCollectionMode: requestedCollectionModeSchema.unwrap(),
    requiredOperations: z.array(operationNameSchema).min(1).max(2),
    requiredOperationStatuses: operationStatusesSchema,
    privacyScopeHmacKeyVersion: boundedOpaqueVersionSchema.nullable(),
    privacyScopeHmacContextId: contextIdSchema.nullable(),
    privacyScopeTokenCanonicalizationVersion: z
      .literal(SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1)
      .nullable(),
    participationStatus: z.enum(["collected", "unavailable"]),
    sourceArtifactSetSha256: sha256Schema.nullable(),
    sourceArtifactSchemaVersion: boundedVersionSchema.nullable(),
    adapterId: boundedIdentifierSchema,
    adapterVersion: boundedVersionSchema,
    inputContractVersion: boundedVersionSchema,
    projectedRecordCount: unsignedIntegerSchema,
    projectedRecordIdsSha256: sha256Schema,
    attemptedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    coverageEvidence: z.discriminatedUnion("coverageKind", [
      unavailableCoverageSchema,
      githubCoverageSchema,
      codexCoverageSchema,
      calendarCoverageSchema,
      notionCoverageSchema,
      dayflowCoverageSchema,
    ]),
    issueCodes: issueCodesSchema,
    sourceCollectionAttestationSha256: sha256Schema,
  })
  .strict();

export type SourceCollectionAttestationInternalV0_1 = z.infer<
  typeof sourceAttestationSchemaInternalV0_1
>;

type ProjectedRecord = Record<string, unknown>;

const ISSUE_CODES_V0_1 = Object.freeze([
  "SOURCE_UNAVAILABLE",
  "COVERAGE_UNKNOWN",
  "SCOPE_PARTIAL",
  "PAGINATION_INCOMPLETE",
  "WINDOW_GAP",
  "COLLECTION_PARTIAL",
  "PREPROCESSING_PARTIAL",
  "UPSTREAM_ERROR_REPORTED",
] as const);

function isProjectedRecord(value: unknown): value is ProjectedRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !intrinsicArrayIsArray(value) &&
    applyIntrinsic<object | null>(
      intrinsicObjectGetPrototypeOf,
      Object,
      [value],
    ) === null
  );
}

function hasExactProjectedKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is ProjectedRecord {
  if (!isProjectedRecord(value)) return false;
  const keys = applyIntrinsic<readonly PropertyKey[]>(
    intrinsicReflectOwnKeys,
    Reflect,
    [value],
  );
  if (keys.length !== expectedKeys.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") return false;
    let found = false;
    for (
      let expectedIndex = 0;
      expectedIndex < expectedKeys.length;
      expectedIndex += 1
    ) {
      if (expectedKeys[expectedIndex] === key) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function isStringLiteral(value: unknown, literals: readonly string[]): value is string {
  if (typeof value !== "string") return false;
  for (let index = 0; index < literals.length; index += 1) {
    if (literals[index] === value) return true;
  }
  return false;
}

function isSha256Value(value: unknown): value is string {
  return typeof value === "string" && regexTest(SHA256_PATTERN, value);
}

function isTimestampValue(value: unknown): value is string {
  if (typeof value !== "string" || !regexTest(TIMESTAMP_PATTERN, value)) {
    return false;
  }
  try {
    const epoch = applyIntrinsic<number>(intrinsicDateParse, IntrinsicDate, [
      value,
    ]);
    if (!applyIntrinsic<boolean>(intrinsicNumberIsFinite, Number, [epoch])) {
      return false;
    }
    const date = new IntrinsicDate(epoch);
    return applyIntrinsic<string>(intrinsicDateToISOString, date, []) === value;
  } catch {
    return false;
  }
}

function isUnsignedIntegerValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    applyIntrinsic<boolean>(intrinsicNumberIsSafeInteger, Number, [value]) &&
    value >= 0 &&
    !applyIntrinsic<boolean>(intrinsicObjectIs, Object, [value, -0])
  );
}

function isBoundedIdentifierValue(value: unknown): value is string {
  return typeof value === "string" && regexTest(BOUNDED_IDENTIFIER_PATTERN, value);
}

function isBoundedVersionValue(value: unknown): value is string {
  return typeof value === "string" && regexTest(BOUNDED_VERSION_PATTERN, value);
}

function isBoundedOpaqueVersionValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    regexTest(BOUNDED_OPAQUE_VERSION_PATTERN, value)
  );
}

function isContextIdValue(value: unknown): value is string {
  return typeof value === "string" && regexTest(CONTEXT_ID_PATTERN, value);
}

function isSourceValue(value: unknown): value is LineageSourceV0_1 {
  return isStringLiteral(value, LINEAGE_SOURCES_V0_1);
}

function isNullable<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
): value is T | null {
  return value === null || predicate(value);
}

function isRequestedModeValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    regexTest(LOWERCASE_SOURCE_VALUE_PATTERN, value)
  );
}

function isOperationNameValue(value: unknown): value is string {
  return isRequestedModeValue(value);
}

function isStatusValue(value: unknown): value is "complete" | "partial" | "unknown" {
  return isStringLiteral(value, ["complete", "partial", "unknown"]);
}

function isIntervalValue(
  value: unknown,
): value is Readonly<{ start: string; end: string }> {
  return (
    hasExactProjectedKeys(value, ["start", "end"]) &&
    isTimestampValue(value.start) &&
    isTimestampValue(value.end) &&
    value.start < value.end
  );
}

function isCoveredIntervalsValue(
  value: unknown,
): value is readonly Readonly<{ start: string; end: string }>[] {
  if (
    !intrinsicArrayIsArray(value) ||
    value.length > LINEAGE_LIMITS_V0_1.maximumCoverageIntervalsPerBinding
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const interval = value[index];
    if (!isIntervalValue(interval)) return false;
    if (index > 0) {
      const previous = value[index - 1];
      if (!isIntervalValue(previous) || previous.end >= interval.start) {
        return false;
      }
    }
  }
  return true;
}

function isIssueCodesValue(value: unknown): boolean {
  if (
    !intrinsicArrayIsArray(value) ||
    value.length > LINEAGE_LIMITS_V0_1.maximumNeutralIssueCodesPerBinding
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isStringLiteral(value[index], ISSUE_CODES_V0_1)) return false;
    if (
      index > 0 &&
      IntrinsicString(value[index - 1]) >= IntrinsicString(value[index])
    ) {
      return false;
    }
  }
  return true;
}

function isOperationNamesValue(
  value: unknown,
  minimum: number,
): value is readonly string[] {
  if (!intrinsicArrayIsArray(value) || value.length < minimum || value.length > 2) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isOperationNameValue(value[index])) return false;
  }
  return true;
}

function isOperationStatusesValue(value: unknown): boolean {
  if (!intrinsicArrayIsArray(value) || value.length > 2) return false;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (
      !hasExactProjectedKeys(entry, ["operation", "status"]) ||
      !isOperationNameValue(entry.operation) ||
      !isStatusValue(entry.status)
    ) {
      return false;
    }
  }
  return true;
}

function isCollectionPlanEntryValue(value: unknown): boolean {
  return (
    hasExactProjectedKeys(value, [
      "source",
      "requestStatus",
      "requestedCollectionMode",
      "requiredOperations",
    ]) &&
    isSourceValue(value.source) &&
    isStringLiteral(value.requestStatus, ["requested", "not_requested"]) &&
    (value.requestedCollectionMode === null ||
      isRequestedModeValue(value.requestedCollectionMode)) &&
    isOperationNamesValue(value.requiredOperations, 0)
  );
}

function isTimezoneContextValue(value: unknown): value is string {
  if (value === "unknown") return true;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    !regexTest(PRINTABLE_ASCII_PATTERN, value)
  ) {
    return false;
  }
  const components = stringSplit(value, "/");
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === "" || component === "." || component === "..") {
      return false;
    }
  }
  return true;
}

function isPreprocessingAccountingValue(value: unknown): boolean {
  if (!isProjectedRecord(value)) return false;
  if (value.accountingKind === "unknown") {
    return hasExactProjectedKeys(value, ["accountingKind"]);
  }
  return (
    value.accountingKind === "known" &&
    hasExactProjectedKeys(value, [
      "accountingKind",
      "eligibleCaptureCount",
      "processedCaptureCount",
    ]) &&
    isUnsignedIntegerValue(value.eligibleCaptureCount) &&
    isUnsignedIntegerValue(value.processedCaptureCount) &&
    value.processedCaptureCount <= value.eligibleCaptureCount
  );
}

function isCoverageValue(value: unknown, allowNotRequested: boolean): boolean {
  if (!isProjectedRecord(value) || typeof value.coverageKind !== "string") {
    return false;
  }
  if (value.coverageKind === "not_requested") {
    return (
      allowNotRequested &&
      hasExactProjectedKeys(value, ["coverageKind", "status"]) &&
      value.status === "not_applicable"
    );
  }
  if (value.coverageKind === "unavailable") {
    return (
      hasExactProjectedKeys(value, ["coverageKind", "status"]) &&
      value.status === "unknown"
    );
  }
  if (value.coverageKind === "github_scope") {
    return (
      hasExactProjectedKeys(value, [
        "coverageKind",
        "status",
        "requestedRepositoryScopeHmacSha256",
        "observedRepositoryScopeHmacSha256",
        "paginationStatus",
        "requestedActivityWindow",
        "coveredActivityIntervals",
      ]) &&
      isStatusValue(value.status) &&
      isSha256Value(value.requestedRepositoryScopeHmacSha256) &&
      isNullable(value.observedRepositoryScopeHmacSha256, isSha256Value) &&
      isStringLiteral(value.paginationStatus, [
        "complete",
        "partial",
        "not_applicable",
        "unknown",
      ]) &&
      isNullable(value.requestedActivityWindow, isIntervalValue) &&
      isNullable(value.coveredActivityIntervals, isCoveredIntervalsValue)
    );
  }
  if (value.coverageKind === "codex_collection") {
    return (
      hasExactProjectedKeys(value, [
        "coverageKind",
        "status",
        "requestedProjectScopeHmacSha256",
        "observedProjectScopeHmacSha256",
        "conversationCollectionStatus",
        "requestedConversationWindow",
        "coveredConversationIntervals",
      ]) &&
      isStatusValue(value.status) &&
      isSha256Value(value.requestedProjectScopeHmacSha256) &&
      isNullable(value.observedProjectScopeHmacSha256, isSha256Value) &&
      isStringLiteral(value.conversationCollectionStatus, [
        "complete",
        "partial",
        "unavailable",
        "unknown",
      ]) &&
      isIntervalValue(value.requestedConversationWindow) &&
      isNullable(value.coveredConversationIntervals, isCoveredIntervalsValue)
    );
  }
  if (value.coverageKind === "calendar_window") {
    return (
      hasExactProjectedKeys(value, [
        "coverageKind",
        "status",
        "requestedWindow",
        "coveredIntervals",
        "timezoneDatabaseVersion",
        "timezoneDatabaseReleaseSha512",
        "timezoneDatabaseProfileVersion",
        "timezoneDatabaseProfileSha256",
        "timezoneContext",
      ]) &&
      isStatusValue(value.status) &&
      isIntervalValue(value.requestedWindow) &&
      isCoveredIntervalsValue(value.coveredIntervals) &&
      value.timezoneDatabaseVersion === TIMEZONE_RELEASE_VERSION_V0_1 &&
      value.timezoneDatabaseReleaseSha512 === TIMEZONE_RELEASE_SHA512_V0_1 &&
      value.timezoneDatabaseProfileVersion === TIMEZONE_PROFILE_VERSION_V0_1 &&
      isSha256Value(value.timezoneDatabaseProfileSha256) &&
      isTimezoneContextValue(value.timezoneContext)
    );
  }
  if (value.coverageKind === "notion_resource_scope") {
    return (
      hasExactProjectedKeys(value, [
        "coverageKind",
        "status",
        "requestedResourceSetHmacSha256",
        "observedResourceSetHmacSha256",
        "paginationStatus",
      ]) &&
      isStatusValue(value.status) &&
      isSha256Value(value.requestedResourceSetHmacSha256) &&
      isNullable(value.observedResourceSetHmacSha256, isSha256Value) &&
      isStringLiteral(value.paginationStatus, [
        "complete",
        "partial",
        "not_applicable",
        "unknown",
      ])
    );
  }
  if (value.coverageKind !== "dayflow_capture_and_preprocessing") return false;
  if (
    !hasExactProjectedKeys(value, [
      "coverageKind",
      "status",
      "captureCoverage",
      "preprocessingCoverage",
    ]) ||
    !isStatusValue(value.status) ||
    !hasExactProjectedKeys(value.captureCoverage, [
      "status",
      "requestedWindow",
      "coveredIntervals",
      "captureArtifactSetSha256",
    ]) ||
    !isStatusValue(value.captureCoverage.status) ||
    !isIntervalValue(value.captureCoverage.requestedWindow) ||
    !isCoveredIntervalsValue(value.captureCoverage.coveredIntervals) ||
    !isSha256Value(value.captureCoverage.captureArtifactSetSha256) ||
    !hasExactProjectedKeys(value.preprocessingCoverage, [
      "status",
      "inputCaptureArtifactSetSha256",
      "accounting",
      "preprocessingVersion",
      "verifierVersion",
      "preprocessingEvidenceSha256",
    ]) ||
    !isStatusValue(value.preprocessingCoverage.status) ||
    !isSha256Value(value.preprocessingCoverage.inputCaptureArtifactSetSha256) ||
    !isPreprocessingAccountingValue(value.preprocessingCoverage.accounting) ||
    !isBoundedVersionValue(value.preprocessingCoverage.preprocessingVersion) ||
    !isBoundedVersionValue(value.preprocessingCoverage.verifierVersion) ||
    !isSha256Value(value.preprocessingCoverage.preprocessingEvidenceSha256)
  ) {
    return false;
  }
  return true;
}

function isSourceBindingValue(value: unknown): boolean {
  return (
    hasExactProjectedKeys(value, [
      "source",
      "participationStatus",
      "sourceCollectionAttestationSha256",
      "sourceArtifactSetSha256",
      "sourceArtifactSchemaVersion",
      "adapterId",
      "adapterVersion",
      "inputContractVersion",
      "collectedAt",
      "recordCount",
      "recordIdsSha256",
      "coverage",
      "requiredOperationStatuses",
      "issueCodes",
    ]) &&
    isSourceValue(value.source) &&
    isStringLiteral(value.participationStatus, [
      "not_requested",
      "collected",
      "unavailable",
    ]) &&
    isNullable(value.sourceCollectionAttestationSha256, isSha256Value) &&
    isNullable(value.sourceArtifactSetSha256, isSha256Value) &&
    isNullable(value.sourceArtifactSchemaVersion, isBoundedVersionValue) &&
    isNullable(value.adapterId, isBoundedIdentifierValue) &&
    isNullable(value.adapterVersion, isBoundedVersionValue) &&
    isNullable(value.inputContractVersion, isBoundedVersionValue) &&
    isNullable(value.collectedAt, isTimestampValue) &&
    isUnsignedIntegerValue(value.recordCount) &&
    isSha256Value(value.recordIdsSha256) &&
    isCoverageValue(value.coverage, true) &&
    isOperationStatusesValue(value.requiredOperationStatuses) &&
    isIssueCodesValue(value.issueCodes)
  );
}

function isReceiptStructuralValue(
  value: unknown,
): value is CommonSuggestionEvidenceLineageReceiptV0_1 {
  if (
    !hasExactProjectedKeys(value, [
      "schemaVersion",
      "asOf",
      "commonSuggestionEvidenceRecordSetSha256",
      "privacyScopeHmacKeyVersion",
      "privacyScopeHmacContextId",
      "privacyScopeTokenCanonicalizationVersion",
      "sourceCollectionPlan",
      "sourceBindings",
      "commonSuggestionEvidenceLineageReceiptSha256",
    ]) ||
    value.schemaVersion !== RECEIPT_SCHEMA_VERSION_V0_1 ||
    !isTimestampValue(value.asOf) ||
    !isSha256Value(value.commonSuggestionEvidenceRecordSetSha256) ||
    !isNullable(value.privacyScopeHmacKeyVersion, isBoundedOpaqueVersionValue) ||
    !isNullable(value.privacyScopeHmacContextId, isContextIdValue) ||
    !(
      value.privacyScopeTokenCanonicalizationVersion === null ||
      value.privacyScopeTokenCanonicalizationVersion ===
        SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1
    ) ||
    !intrinsicArrayIsArray(value.sourceCollectionPlan) ||
    value.sourceCollectionPlan.length !== LINEAGE_SOURCES_V0_1.length ||
    !intrinsicArrayIsArray(value.sourceBindings) ||
    value.sourceBindings.length !== LINEAGE_SOURCES_V0_1.length ||
    !isSha256Value(value.commonSuggestionEvidenceLineageReceiptSha256)
  ) {
    return false;
  }
  for (let index = 0; index < LINEAGE_SOURCES_V0_1.length; index += 1) {
    if (
      !isCollectionPlanEntryValue(value.sourceCollectionPlan[index]) ||
      !isSourceBindingValue(value.sourceBindings[index])
    ) {
      return false;
    }
  }
  return true;
}

function isSourceAttestationStructuralValue(
  value: unknown,
): value is SourceCollectionAttestationInternalV0_1 {
  return (
    hasExactProjectedKeys(value, [
      "schemaVersion",
      "source",
      "requestedCollectionMode",
      "requiredOperations",
      "requiredOperationStatuses",
      "privacyScopeHmacKeyVersion",
      "privacyScopeHmacContextId",
      "privacyScopeTokenCanonicalizationVersion",
      "participationStatus",
      "sourceArtifactSetSha256",
      "sourceArtifactSchemaVersion",
      "adapterId",
      "adapterVersion",
      "inputContractVersion",
      "projectedRecordCount",
      "projectedRecordIdsSha256",
      "attemptedAt",
      "completedAt",
      "coverageEvidence",
      "issueCodes",
      "sourceCollectionAttestationSha256",
    ]) &&
    value.schemaVersion === SOURCE_ATTESTATION_SCHEMA_VERSION_V0_1 &&
    isSourceValue(value.source) &&
    isRequestedModeValue(value.requestedCollectionMode) &&
    isOperationNamesValue(value.requiredOperations, 1) &&
    isOperationStatusesValue(value.requiredOperationStatuses) &&
    isNullable(value.privacyScopeHmacKeyVersion, isBoundedOpaqueVersionValue) &&
    isNullable(value.privacyScopeHmacContextId, isContextIdValue) &&
    (value.privacyScopeTokenCanonicalizationVersion === null ||
      value.privacyScopeTokenCanonicalizationVersion ===
        SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1) &&
    isStringLiteral(value.participationStatus, ["collected", "unavailable"]) &&
    isNullable(value.sourceArtifactSetSha256, isSha256Value) &&
    isNullable(value.sourceArtifactSchemaVersion, isBoundedVersionValue) &&
    isBoundedIdentifierValue(value.adapterId) &&
    isBoundedVersionValue(value.adapterVersion) &&
    isBoundedVersionValue(value.inputContractVersion) &&
    isUnsignedIntegerValue(value.projectedRecordCount) &&
    isSha256Value(value.projectedRecordIdsSha256) &&
    isTimestampValue(value.attemptedAt) &&
    isNullable(value.completedAt, isTimestampValue) &&
    isCoverageValue(value.coverageEvidence, false) &&
    isIssueCodesValue(value.issueCodes) &&
    isSha256Value(value.sourceCollectionAttestationSha256)
  );
}

function materializeTrustedPlainData<T>(value: unknown): T {
  if (value === null || typeof value !== "object") return value as T;
  if (intrinsicArrayIsArray(value)) {
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      arrayPushValue(output, materializeTrustedPlainData(value[index]));
    }
    return output as T;
  }
  const output: Record<string, unknown> = {};
  const keys = applyIntrinsic<readonly PropertyKey[]>(
    intrinsicReflectOwnKeys,
    Reflect,
    [value],
  );
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw INPUT_ABORT;
    applyIntrinsic<void>(intrinsicObjectDefineProperty, Object, [
      output,
      key,
      {
        value: materializeTrustedPlainData(
          (value as Record<string, unknown>)[key],
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      },
    ]);
  }
  return output as T;
}

type InternalParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failureCode: LineageFailureCodeV0_1 }>;

const RESOURCE_ABORT = freezeObject({ resource: true });
const INPUT_ABORT = freezeObject({ input: true });
const utf8Encoder = new IntrinsicTextEncoder();
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = applyIntrinsic<number>(intrinsicStringCharCodeAt, value, [
      index,
    ]);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = applyIntrinsic<number>(intrinsicStringCharCodeAt, value, [
        index + 1,
      ]);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isSortedUniqueAscii(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] ?? "") >= (values[index] ?? "")) return false;
  }
  return true;
}

function enumerableDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    Object,
    [value, key],
  );
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    throw INPUT_ABORT;
  }
  return descriptor.value;
}

function cloneSubmittedPlainData(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  counter: { enumerableProperties: number },
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!isUnicodeScalarString(value)) throw INPUT_ABORT;
    if (
      typedArrayByteLength(textEncode(value)) >
      LINEAGE_LIMITS_V0_1.maximumPrivateScopeHmacPreimageBytes
    ) {
      throw RESOURCE_ABORT;
    }
    return value;
  }
  if (typeof value === "number") {
    if (
      !applyIntrinsic<boolean>(intrinsicNumberIsSafeInteger, Number, [value]) ||
      value < 0 ||
      applyIntrinsic<boolean>(intrinsicObjectIs, Object, [value, -0])
    ) {
      throw INPUT_ABORT;
    }
    return value;
  }
  if (
    typeof value !== "object" ||
    isNodeProxy(value) ||
    depth > LINEAGE_LIMITS_V0_1.maximumInputGraphDepth
  ) {
    if (depth > LINEAGE_LIMITS_V0_1.maximumInputGraphDepth) {
      throw RESOURCE_ABORT;
    }
    throw INPUT_ABORT;
  }
  if (weakSetHas(seen, value)) throw INPUT_ABORT;
  weakSetAdd(seen, value);

  if (intrinsicArrayIsArray(value)) {
    if (
      applyIntrinsic<object | null>(intrinsicObjectGetPrototypeOf, Object, [
        value,
      ]) !== arrayPrototype
    ) {
      throw INPUT_ABORT;
    }
    const lengthDescriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      intrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [value, "length"],
    );
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !applyIntrinsic<boolean>(intrinsicNumberIsSafeInteger, Number, [
        lengthDescriptor.value,
      ]) ||
      lengthDescriptor.value < 0
    ) {
      throw INPUT_ABORT;
    }
    const length = lengthDescriptor.value as number;
    if (
      counter.enumerableProperties + length >
      LINEAGE_LIMITS_V0_1.maximumEnumerableOwnProperties
    ) {
      throw RESOURCE_ABORT;
    }
    const keys = reflectOwnKeys(value);
    if (keys.length !== length + 1) throw INPUT_ABORT;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      counter.enumerableProperties += 1;
      arrayPushValue(
        output,
        cloneSubmittedPlainData(
          enumerableDataValue(value, IntrinsicString(index)),
          depth + 1,
          seen,
          counter,
        ),
      );
    }
    return output;
  }

  if (
    applyIntrinsic<object | null>(intrinsicObjectGetPrototypeOf, Object, [
      value,
    ]) !== objectPrototype
  ) {
    throw INPUT_ABORT;
  }
  const keys = reflectOwnKeys(value);
  if (
    counter.enumerableProperties + keys.length >
    LINEAGE_LIMITS_V0_1.maximumEnumerableOwnProperties
  ) {
    throw RESOURCE_ABORT;
  }
  const output = applyIntrinsic<Record<string, unknown>>(
    intrinsicObjectCreate,
    Object,
    [null],
  );
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== "string" || !isUnicodeScalarString(key)) {
      throw INPUT_ABORT;
    }
    counter.enumerableProperties += 1;
    applyIntrinsic<void>(intrinsicObjectDefineProperty, Object, [
      output,
      key,
      {
        value: cloneSubmittedPlainData(
          enumerableDataValue(value, key),
          depth + 1,
          seen,
          counter,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      },
    ]);
  }
  return output;
}

function projectSubmittedPlainData(input: unknown): InternalParseResult<unknown> {
  try {
    return freezeObject({
      ok: true,
      value: cloneSubmittedPlainData(input, 0, new IntrinsicWeakSet(), {
        enumerableProperties: 0,
      }),
    });
  } catch (error) {
    return freezeObject({
      ok: false,
      failureCode:
        error === RESOURCE_ABORT
          ? "RESOURCE_LIMIT_EXCEEDED"
          : "INPUT_INVALID",
    });
  }
}

export function deepFreezeLineageInternalV0_1<T>(value: T): T {
  if (value === null || typeof value !== "object" || objectIsFrozen(value)) {
    return value;
  }
  const keys = reflectOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      intrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [value, keys[index]],
    );
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezeLineageInternalV0_1(descriptor.value);
    }
  }
  return freezeObject(value);
}

const MODE_SPECIFICATIONS_V0_1 = Object.freeze({
  github: Object.freeze({
    repository_scope: Object.freeze(["repository_scope_collection"] as const),
    repository_activity: Object.freeze([
      "repository_scope_collection",
      "activity_pagination",
    ] as const),
  }),
  codex: Object.freeze({
    project_conversations: Object.freeze([
      "project_scope_collection",
      "conversation_collection",
    ] as const),
  }),
  google_calendar: Object.freeze({
    event_window: Object.freeze(["event_window_collection"] as const),
  }),
  notion: Object.freeze({
    resource_scope: Object.freeze(["resource_scope_collection"] as const),
    resource_collection: Object.freeze([
      "resource_scope_collection",
      "resource_pagination",
    ] as const),
  }),
  dayflow: Object.freeze({
    capture_privacy_ocr: Object.freeze([
      "capture_window_collection",
      "privacy_ocr_preprocessing",
    ] as const),
  }),
});

function modeOperations(
  source: LineageSourceV0_1,
  mode: string,
): readonly string[] | null {
  const modes = MODE_SPECIFICATIONS_V0_1[source] as Readonly<
    Record<string, readonly string[]>
  >;
  return objectHasOwn(modes, mode) ? modes[mode]! : null;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    arrayEvery(left, (value, index) => value === right[index])
  );
}

export function hashRecordIdSetInternalV0_1(
  source: LineageSourceV0_1,
  recordIds: readonly string[],
): string {
  const sortedRecordIds: string[] = [];
  for (let index = 0; index < recordIds.length; index += 1) {
    sortedRecordIds[index] = recordIds[index]!;
  }
  arraySortStrings(sortedRecordIds);
  if (!isSortedUniqueAscii(sortedRecordIds)) {
    throw new IntrinsicTypeError("Record IDs must be unique");
  }
  return domainSeparatedSha256(RECORD_ID_SET_HASH_DOMAIN_V0_1, {
    recordIds: sortedRecordIds,
    source,
  });
}

function coverageStatus(
  coverage: CommonSuggestionEvidenceLineageReceiptV0_1["sourceBindings"][number]["coverage"],
): "complete" | "partial" | "unknown" | "not_applicable" {
  return coverage.status;
}

function coverageMatchesSource(
  source: LineageSourceV0_1,
  coverageKind: string,
): boolean {
  return (
    (source === "github" && coverageKind === "github_scope") ||
    (source === "codex" && coverageKind === "codex_collection") ||
    (source === "google_calendar" && coverageKind === "calendar_window") ||
    (source === "notion" && coverageKind === "notion_resource_scope") ||
    (source === "dayflow" &&
      coverageKind === "dayflow_capture_and_preprocessing")
  );
}

function hasScopeHmac(receipt: CommonSuggestionEvidenceLineageReceiptV0_1): boolean {
  return arraySome(receipt.sourceBindings, (binding) =>
    arrayIncludes(
      ["github_scope", "codex_collection", "notion_resource_scope"],
      binding.coverage.coverageKind,
    ),
  );
}

function validateModeSpecificCoverage(
  source: LineageSourceV0_1,
  mode: string,
  coverage: CommonSuggestionEvidenceLineageReceiptV0_1["sourceBindings"][number]["coverage"],
): boolean {
  if (source === "github" && coverage.coverageKind === "github_scope") {
    if (mode === "repository_scope") {
      return (
        coverage.paginationStatus === "not_applicable" &&
        coverage.requestedActivityWindow === null &&
        coverage.coveredActivityIntervals === null
      );
    }
    return (
      mode === "repository_activity" &&
      coverage.paginationStatus !== "not_applicable" &&
      coverage.requestedActivityWindow !== null
    );
  }
  if (
    source === "notion" &&
    coverage.coverageKind === "notion_resource_scope"
  ) {
    return mode === "resource_scope"
      ? coverage.paginationStatus === "not_applicable"
      : mode === "resource_collection" &&
          coverage.paginationStatus !== "not_applicable";
  }
  return true;
}

function intervalsStayWithinWindow(
  intervals: readonly Readonly<{ start: string; end: string }>[] | null,
  window: Readonly<{ start: string; end: string }> | null,
): boolean {
  if (intervals === null) return true;
  if (window === null) return intervals.length === 0;
  return arrayEvery(
    intervals,
    (interval) => interval.start >= window.start && interval.end <= window.end,
  );
}

function validateCoverageStructuralBindings(
  binding: CommonSuggestionEvidenceLineageReceiptV0_1["sourceBindings"][number],
): boolean {
  const coverage = binding.coverage;
  if (coverage.coverageKind === "github_scope") {
    return intervalsStayWithinWindow(
      coverage.coveredActivityIntervals,
      coverage.requestedActivityWindow,
    );
  }
  if (coverage.coverageKind === "codex_collection") {
    return intervalsStayWithinWindow(
      coverage.coveredConversationIntervals,
      coverage.requestedConversationWindow,
    );
  }
  if (coverage.coverageKind === "calendar_window") {
    return intervalsStayWithinWindow(
      coverage.coveredIntervals,
      coverage.requestedWindow,
    );
  }
  if (coverage.coverageKind === "dayflow_capture_and_preprocessing") {
    const captureStatus = binding.requiredOperationStatuses[0]?.status;
    const preprocessingStatus = binding.requiredOperationStatuses[1]?.status;
    return (
      intervalsStayWithinWindow(
        coverage.captureCoverage.coveredIntervals,
        coverage.captureCoverage.requestedWindow,
      ) &&
      coverage.preprocessingCoverage.inputCaptureArtifactSetSha256 ===
        coverage.captureCoverage.captureArtifactSetSha256 &&
      coverage.preprocessingCoverage.preprocessingEvidenceSha256 ===
        binding.sourceArtifactSetSha256 &&
      coverage.captureCoverage.status === captureStatus &&
      coverage.preprocessingCoverage.status === preprocessingStatus &&
      (coverage.preprocessingCoverage.accounting.accountingKind !== "unknown" ||
        coverage.preprocessingCoverage.status === "unknown")
    );
  }
  return true;
}

function validateReceiptRelationships(
  receipt: CommonSuggestionEvidenceLineageReceiptV0_1,
): boolean {
  const hmacPresent = hasScopeHmac(receipt);
  const hmacMetadata = [
    receipt.privacyScopeHmacKeyVersion,
    receipt.privacyScopeHmacContextId,
    receipt.privacyScopeTokenCanonicalizationVersion,
  ];
  if (
    hmacPresent
      ? arraySome(hmacMetadata, (value) => value === null)
      : arraySome(hmacMetadata, (value) => value !== null)
  ) {
    return false;
  }

  for (let index = 0; index < LINEAGE_SOURCES_V0_1.length; index += 1) {
    const expectedSource = LINEAGE_SOURCES_V0_1[index]!;
    const plan = receipt.sourceCollectionPlan[index]!;
    const binding = receipt.sourceBindings[index]!;
    if (plan.source !== expectedSource || binding.source !== expectedSource) {
      return false;
    }
    if (plan.requestStatus === "not_requested") {
      if (
        plan.requestedCollectionMode !== null ||
        plan.requiredOperations.length !== 0 ||
        binding.participationStatus !== "not_requested" ||
        binding.sourceCollectionAttestationSha256 !== null ||
        binding.sourceArtifactSetSha256 !== null ||
        binding.sourceArtifactSchemaVersion !== null ||
        binding.adapterId !== null ||
        binding.adapterVersion !== null ||
        binding.inputContractVersion !== null ||
        binding.collectedAt !== null ||
        binding.recordCount !== 0 ||
        binding.recordIdsSha256 !==
          hashRecordIdSetInternalV0_1(expectedSource, []) ||
        binding.coverage.coverageKind !== "not_requested" ||
        binding.requiredOperationStatuses.length !== 0 ||
        binding.issueCodes.length !== 0
      ) {
        return false;
      }
      continue;
    }

    if (plan.requestedCollectionMode === null) return false;
    const expectedOperations = modeOperations(
      expectedSource,
      plan.requestedCollectionMode,
    );
    if (
      expectedOperations === null ||
      !arraysEqual(plan.requiredOperations, expectedOperations) ||
      !arraysEqual(
        arrayMap(
          binding.requiredOperationStatuses,
          (entry) => entry.operation,
        ),
        expectedOperations,
      )
    ) {
      return false;
    }
    if (binding.participationStatus === "not_requested") return false;
    if (binding.participationStatus === "unavailable") {
      if (
        binding.sourceCollectionAttestationSha256 === null ||
        binding.sourceArtifactSetSha256 !== null ||
        binding.adapterId === null ||
        binding.adapterVersion === null ||
        binding.inputContractVersion === null ||
        binding.collectedAt === null ||
        binding.recordCount !== 0 ||
        binding.recordIdsSha256 !==
          hashRecordIdSetInternalV0_1(expectedSource, []) ||
        binding.coverage.coverageKind !== "unavailable" ||
        arraySome(
          binding.requiredOperationStatuses,
          (entry) => entry.status !== "unknown",
        ) ||
        !arrayIncludes(binding.issueCodes, "SOURCE_UNAVAILABLE")
      ) {
        return false;
      }
      continue;
    }

    if (
      binding.sourceCollectionAttestationSha256 === null ||
      binding.sourceArtifactSetSha256 === null ||
      binding.sourceArtifactSchemaVersion === null ||
      binding.adapterId === null ||
      binding.adapterVersion === null ||
      binding.inputContractVersion === null ||
      binding.collectedAt === null ||
      !coverageMatchesSource(expectedSource, binding.coverage.coverageKind) ||
      !validateModeSpecificCoverage(
        expectedSource,
        plan.requestedCollectionMode,
        binding.coverage,
      ) ||
      !validateCoverageStructuralBindings(binding)
    ) {
      return false;
    }

    const statuses = arrayMap(
      binding.requiredOperationStatuses,
      (entry) => entry.status,
    );
    const aggregate = arrayIncludes(statuses, "unknown")
      ? "unknown"
      : arrayEvery(statuses, (status) => status === "complete")
        ? "complete"
        : "partial";
    if (coverageStatus(binding.coverage) !== aggregate) return false;
    if (
      (aggregate === "complete" && binding.issueCodes.length !== 0) ||
      (aggregate !== "complete" && binding.issueCodes.length === 0)
    ) {
      return false;
    }
  }
  return true;
}

function preclassifySourceBindingShape(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const root = value as Record<string, unknown>;
  return (
    intrinsicArrayIsArray(root.sourceCollectionPlan) &&
    root.sourceCollectionPlan.length === LINEAGE_SOURCES_V0_1.length &&
    intrinsicArrayIsArray(root.sourceBindings) &&
    root.sourceBindings.length === LINEAGE_SOURCES_V0_1.length
  );
}

function collectionLengthOver(
  value: unknown,
  maximum: number,
): boolean {
  return intrinsicArrayIsArray(value) && value.length > maximum;
}

function receiptSemanticResourceLimitExceeded(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const root = value as Record<string, unknown>;
  if (
    collectionLengthOver(
      root.sourceCollectionPlan,
      LINEAGE_LIMITS_V0_1.maximumSourceBindings,
    ) ||
    collectionLengthOver(
      root.sourceBindings,
      LINEAGE_LIMITS_V0_1.maximumSourceBindings,
    )
  ) {
    return true;
  }
  if (!intrinsicArrayIsArray(root.sourceBindings)) return false;
  return arraySome(root.sourceBindings, (candidate) => {
    if (candidate === null || typeof candidate !== "object") return false;
    const binding = candidate as Record<string, unknown>;
    if (
      collectionLengthOver(
        binding.requiredOperationStatuses,
        2,
      ) ||
      collectionLengthOver(
        binding.issueCodes,
        LINEAGE_LIMITS_V0_1.maximumNeutralIssueCodesPerBinding,
      )
    ) {
      return true;
    }
    if (binding.coverage === null || typeof binding.coverage !== "object") {
      return false;
    }
    const coverage = binding.coverage as Record<string, unknown>;
    if (
      collectionLengthOver(
        coverage.coveredActivityIntervals,
        LINEAGE_LIMITS_V0_1.maximumCoverageIntervalsPerBinding,
      ) ||
      collectionLengthOver(
        coverage.coveredConversationIntervals,
        LINEAGE_LIMITS_V0_1.maximumCoverageIntervalsPerBinding,
      ) ||
      collectionLengthOver(
        coverage.coveredIntervals,
        LINEAGE_LIMITS_V0_1.maximumCoverageIntervalsPerBinding,
      )
    ) {
      return true;
    }
    if (
      coverage.captureCoverage !== null &&
      typeof coverage.captureCoverage === "object"
    ) {
      return collectionLengthOver(
        (coverage.captureCoverage as Record<string, unknown>).coveredIntervals,
        LINEAGE_LIMITS_V0_1.maximumCoverageIntervalsPerBinding,
      );
    }
    return false;
  });
}

export function parseReceiptStructuralInternalV0_1(
  input: unknown,
): InternalParseResult<CommonSuggestionEvidenceLineageReceiptV0_1> {
  const projected = projectSubmittedPlainData(input);
  if (!projected.ok) return projected;
  try {
    if (receiptSemanticResourceLimitExceeded(projected.value)) {
      return freezeObject({
        ok: false,
        failureCode: "RESOURCE_LIMIT_EXCEEDED",
      });
    }
    if (!preclassifySourceBindingShape(projected.value)) {
      return freezeObject({
        ok: false,
        failureCode: "SOURCE_BINDING_INVALID",
      });
    }
    if (!isReceiptStructuralValue(projected.value)) {
      return freezeObject({ ok: false, failureCode: "INPUT_INVALID" });
    }
    if (!validateReceiptRelationships(projected.value)) {
      return freezeObject({
        ok: false,
        failureCode: "SOURCE_BINDING_INVALID",
      });
    }
    const materialized = materializeTrustedPlainData<
      CommonSuggestionEvidenceLineageReceiptV0_1
    >(projected.value);
    return freezeObject({
      ok: true,
      value: deepFreezeLineageInternalV0_1(materialized),
    });
  } catch {
    return freezeObject({ ok: false, failureCode: "INPUT_INVALID" });
  }
}

function receiptHashPreimage(
  receipt: CommonSuggestionEvidenceLineageReceiptV0_1,
): Omit<
  CommonSuggestionEvidenceLineageReceiptV0_1,
  "commonSuggestionEvidenceLineageReceiptSha256"
> {
  const {
    commonSuggestionEvidenceLineageReceiptSha256: _detachedHash,
    ...preimage
  } = receipt;
  return preimage;
}

export function hashLineageReceiptInternalV0_1(
  receipt: CommonSuggestionEvidenceLineageReceiptV0_1,
): string {
  return domainSeparatedSha256(
    RECEIPT_HASH_DOMAIN_V0_1,
    receiptHashPreimage(receipt),
  );
}

export type InspectReceiptIntrinsicInternalResultV0_1 =
  | Readonly<{
      inspected: true;
      authoritative: false;
      stage: "intrinsic_receipt";
      receipt: CommonSuggestionEvidenceLineageReceiptV0_1;
    }>
  | Readonly<{
      inspected: false;
      authoritative: false;
      stage: "intrinsic_receipt";
      failureCode: LineageFailureCodeV0_1;
    }>;

export function inspectReceiptIntrinsicInternalV0_1(
  input: unknown,
): InspectReceiptIntrinsicInternalResultV0_1 {
  const parsed = parseReceiptStructuralInternalV0_1(input);
  if (!parsed.ok) {
    return deepFreezeLineageInternalV0_1({
      inspected: false,
      authoritative: false,
      stage: "intrinsic_receipt",
      failureCode: parsed.failureCode,
    });
  }
  try {
    const fullBytes =
      typedArrayByteLength(textEncode(jcsCanonicalize(parsed.value))) + 1;
    const preimageBytes = typedArrayByteLength(
      textEncode(jcsCanonicalize(receiptHashPreimage(parsed.value))),
    );
    if (
      fullBytes > LINEAGE_LIMITS_V0_1.maximumCanonicalReceiptBytes ||
      preimageBytes > LINEAGE_LIMITS_V0_1.maximumCanonicalReceiptBytes
    ) {
      return deepFreezeLineageInternalV0_1({
        inspected: false,
        authoritative: false,
        stage: "intrinsic_receipt",
        failureCode: "RESOURCE_LIMIT_EXCEEDED",
      });
    }
    if (
      hashLineageReceiptInternalV0_1(parsed.value) !==
      parsed.value.commonSuggestionEvidenceLineageReceiptSha256
    ) {
      return deepFreezeLineageInternalV0_1({
        inspected: false,
        authoritative: false,
        stage: "intrinsic_receipt",
        failureCode: "HASH_MISMATCH",
      });
    }
  } catch {
    return deepFreezeLineageInternalV0_1({
      inspected: false,
      authoritative: false,
      stage: "intrinsic_receipt",
      failureCode: "INPUT_INVALID",
    });
  }
  return deepFreezeLineageInternalV0_1({
    inspected: true,
    authoritative: false,
    stage: "intrinsic_receipt",
    receipt: parsed.value,
  });
}

function attestationHasScopeHmac(
  attestation: SourceCollectionAttestationInternalV0_1,
): boolean {
  return arrayIncludes(["github", "codex", "notion"], attestation.source);
}

function validateSourceAttestationRelationships(
  attestation: SourceCollectionAttestationInternalV0_1,
): boolean {
  const expectedOperations = modeOperations(
    attestation.source,
    attestation.requestedCollectionMode,
  );
  const statusOperations = arrayMap(
    attestation.requiredOperationStatuses,
    (entry) => entry.operation,
  );
  if (
    expectedOperations === null ||
    !arraysEqual(attestation.requiredOperations, expectedOperations) ||
    !arraysEqual(statusOperations, expectedOperations) ||
    !arraysEqual(statusOperations, attestation.requiredOperations)
  ) {
    return false;
  }
  const statuses = arrayMap(
    attestation.requiredOperationStatuses,
    (entry) => entry.status,
  );
  const aggregate = arrayIncludes(statuses, "unknown")
    ? "unknown"
    : arrayEvery(statuses, (status) => status === "complete")
      ? "complete"
      : "partial";
  if (
    coverageStatus(attestation.coverageEvidence) !== aggregate ||
    (aggregate === "complete"
      ? attestation.issueCodes.length !== 0
      : attestation.issueCodes.length === 0)
  ) {
    return false;
  }
  const hmacPresent = attestationHasScopeHmac(attestation);
  const hmacMetadata = [
    attestation.privacyScopeHmacKeyVersion,
    attestation.privacyScopeHmacContextId,
    attestation.privacyScopeTokenCanonicalizationVersion,
  ];
  if (
    hmacPresent
      ? arraySome(hmacMetadata, (value) => value === null)
      : arraySome(hmacMetadata, (value) => value !== null)
  ) {
    return false;
  }
  if (attestation.participationStatus === "unavailable") {
    return (
      attestation.completedAt === null &&
      attestation.sourceArtifactSetSha256 === null &&
      attestation.projectedRecordCount === 0 &&
      attestation.projectedRecordIdsSha256 ===
        hashRecordIdSetInternalV0_1(attestation.source, []) &&
      attestation.coverageEvidence.coverageKind === "unavailable" &&
      !arraySome(
        attestation.requiredOperationStatuses,
        (entry) => entry.status !== "unknown",
      ) &&
      arrayIncludes(attestation.issueCodes, "SOURCE_UNAVAILABLE")
    );
  }
  if (
    attestation.completedAt === null ||
    attestation.completedAt < attestation.attemptedAt
  ) {
    return false;
  }
  const coverage = attestation.coverageEvidence;
  if (coverage.coverageKind === "github_scope") {
    if (
      !intervalsStayWithinWindow(
        coverage.coveredActivityIntervals,
        coverage.requestedActivityWindow,
      )
    ) {
      return false;
    }
  } else if (coverage.coverageKind === "codex_collection") {
    if (
      !intervalsStayWithinWindow(
        coverage.coveredConversationIntervals,
        coverage.requestedConversationWindow,
      )
    ) {
      return false;
    }
  } else if (coverage.coverageKind === "calendar_window") {
    if (!intervalsStayWithinWindow(coverage.coveredIntervals, coverage.requestedWindow)) {
      return false;
    }
  } else if (coverage.coverageKind === "dayflow_capture_and_preprocessing") {
    const captureStatus = attestation.requiredOperationStatuses[0]?.status;
    const preprocessingStatus =
      attestation.requiredOperationStatuses[1]?.status;
    if (
      !intervalsStayWithinWindow(
        coverage.captureCoverage.coveredIntervals,
        coverage.captureCoverage.requestedWindow,
      ) ||
      coverage.preprocessingCoverage.inputCaptureArtifactSetSha256 !==
        coverage.captureCoverage.captureArtifactSetSha256 ||
      coverage.preprocessingCoverage.preprocessingEvidenceSha256 !==
        attestation.sourceArtifactSetSha256 ||
      coverage.captureCoverage.status !== captureStatus ||
      coverage.preprocessingCoverage.status !== preprocessingStatus ||
      (coverage.preprocessingCoverage.accounting.accountingKind === "unknown" &&
        coverage.preprocessingCoverage.status !== "unknown")
    ) {
      return false;
    }
  }
  return (
    attestation.sourceArtifactSetSha256 !== null &&
    attestation.sourceArtifactSchemaVersion !== null &&
    attestation.completedAt !== null &&
    coverageMatchesSource(
      attestation.source,
      attestation.coverageEvidence.coverageKind,
    )
  );
}

function attestationHashPreimage(
  attestation: SourceCollectionAttestationInternalV0_1,
): Omit<
  SourceCollectionAttestationInternalV0_1,
  "sourceCollectionAttestationSha256"
> {
  const { sourceCollectionAttestationSha256: _detachedHash, ...preimage } =
    attestation;
  return preimage;
}

export function hashSourceAttestationInternalV0_1(
  attestation: SourceCollectionAttestationInternalV0_1,
): string {
  return domainSeparatedSha256(
    SOURCE_ATTESTATION_HASH_DOMAIN_V0_1,
    attestationHashPreimage(attestation),
  );
}

export function parseSourceAttestationStructuralInternalV0_1(
  input: unknown,
): InternalParseResult<SourceCollectionAttestationInternalV0_1> {
  const projected = projectSubmittedPlainData(input);
  if (!projected.ok) return projected;
  try {
    if (
      receiptSemanticResourceLimitExceeded({
        sourceBindings: [
          isProjectedRecord(projected.value)
            ? {
                requiredOperationStatuses:
                  projected.value.requiredOperationStatuses,
                issueCodes: projected.value.issueCodes,
                coverage: projected.value.coverageEvidence,
              }
            : projected.value,
        ],
      })
    ) {
      return freezeObject({
        ok: false,
        failureCode: "RESOURCE_LIMIT_EXCEEDED",
      });
    }
    if (!isSourceAttestationStructuralValue(projected.value)) {
      return freezeObject({
        ok: false,
        failureCode: "SOURCE_ATTESTATION_INVALID",
      });
    }
    if (!validateSourceAttestationRelationships(projected.value)) {
      return freezeObject({
        ok: false,
        failureCode: "SOURCE_ATTESTATION_INVALID",
      });
    }
    const fullBytes =
      typedArrayByteLength(textEncode(jcsCanonicalize(projected.value))) + 1;
    const preimageBytes = typedArrayByteLength(
      textEncode(jcsCanonicalize(attestationHashPreimage(projected.value))),
    );
    if (
      fullBytes >
        LINEAGE_LIMITS_V0_1.maximumCanonicalSourceAttestationBytes ||
      preimageBytes >
        LINEAGE_LIMITS_V0_1.maximumCanonicalSourceAttestationBytes
    ) {
      return freezeObject({
        ok: false,
        failureCode: "RESOURCE_LIMIT_EXCEEDED",
      });
    }
    if (
      hashSourceAttestationInternalV0_1(projected.value) !==
      projected.value.sourceCollectionAttestationSha256
    ) {
      return freezeObject({ ok: false, failureCode: "HASH_MISMATCH" });
    }
    const materialized = materializeTrustedPlainData<
      SourceCollectionAttestationInternalV0_1
    >(projected.value);
    return freezeObject({
      ok: true,
      value: deepFreezeLineageInternalV0_1(materialized),
    });
  } catch {
    return freezeObject({
      ok: false,
      failureCode: "SOURCE_ATTESTATION_INVALID",
    });
  }
}

type GithubScopeIdentifierV0_1 = Readonly<{
  host: string;
  repositoryDatabaseId: string;
}>;
type CodexScopeIdentifierV0_1 = Readonly<{
  lexicalProjectKey: string;
  pathFlavor: "posix";
}>;
type NotionScopeIdentifierV0_1 = Readonly<{ resourceId: string }>;

export type PrivateScopeIdentifierInputInternalV0_1 =
  | Readonly<{
      source: "github";
      scopeKind: "repository_scope";
      identifiers: readonly GithubScopeIdentifierV0_1[];
    }>
  | Readonly<{
      source: "codex";
      scopeKind: "project_scope";
      identifiers: readonly [CodexScopeIdentifierV0_1];
    }>
  | Readonly<{
      source: "notion";
      scopeKind: "resource_set";
      identifiers: readonly NotionScopeIdentifierV0_1[];
    }>;

function canonicalizeGithubIdentifier(
  identifier: GithubScopeIdentifierV0_1,
): GithubScopeIdentifierV0_1 {
  let host = identifier.host;
  if (stringEndsWith(host, ".")) host = stringSlice(host, 0, -1);
  host = stringToLowerCase(host);
  const hostLabels = stringSplit(host, ".");
  if (
    typedArrayByteLength(textEncode(host)) > 253 ||
    host.length === 0 ||
    !arrayEvery(
      hostLabels,
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        regexTest(
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u,
          label,
        ),
    ) ||
    !regexTest(/^[1-9][0-9]{0,19}$/u, identifier.repositoryDatabaseId)
  ) {
    throw INPUT_ABORT;
  }
  return freezeObject({
    host,
    repositoryDatabaseId: identifier.repositoryDatabaseId,
  });
}

function canonicalizeCodexIdentifier(
  identifier: CodexScopeIdentifierV0_1,
): CodexScopeIdentifierV0_1 {
  const path = identifier.lexicalProjectKey;
  const pathComponents = arraySlice(stringSplit(path, "/"), 1);
  if (
    identifier.pathFlavor !== "posix" ||
    stringNormalize(path) !== path ||
    typedArrayByteLength(textEncode(path)) > 1_400 ||
    !stringStartsWith(path, "/") ||
    stringStartsWith(path, "//") ||
    (path.length > 1 && stringEndsWith(path, "/")) ||
    stringIncludes(path, "\0") ||
    (path !== "/" && arraySome(
      pathComponents,
      (component) =>
        component === "" || component === "." || component === "..",
    ))
  ) {
    throw INPUT_ABORT;
  }
  return freezeObject({ lexicalProjectKey: path, pathFlavor: "posix" });
}

function canonicalizeNotionIdentifier(
  identifier: NotionScopeIdentifierV0_1,
): NotionScopeIdentifierV0_1 {
  const compact = stringToLowerCase(
    stringReplaceAll(identifier.resourceId, "-", ""),
  );
  if (
    !(
      regexTest(/^[0-9a-fA-F]{32}$/u, identifier.resourceId) ||
      regexTest(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u,
        identifier.resourceId,
      )
    )
  ) {
    throw INPUT_ABORT;
  }
  return freezeObject({
    resourceId: `${stringSlice(compact, 0, 8)}-${stringSlice(compact, 8, 12)}-${stringSlice(compact, 12, 16)}-${stringSlice(compact, 16, 20)}-${stringSlice(compact, 20)}`,
  });
}

function canonicalToken(identifier: unknown): string {
  const buffer = applyIntrinsic<Buffer>(intrinsicBufferFrom, Buffer, [
    textEncode(jcsCanonicalize(identifier)),
  ]);
  return applyIntrinsic<string>(intrinsicBufferToString, buffer, ["base64url"]);
}

export type PrivateScopeHmacPreimageInternalV0_1 = Readonly<{
  domain: typeof PRIVATE_SCOPE_HMAC_DOMAIN_V0_1;
  contextId: string;
  source: "github" | "codex" | "notion";
  scopeKind: "repository_scope" | "project_scope" | "resource_set";
  tokenCanonicalizationVersion: typeof SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1;
  canonicalTokens: readonly string[];
}>;

export function buildPrivateScopeHmacPreimageInternalV0_1(input: {
  contextId: string;
  scope: PrivateScopeIdentifierInputInternalV0_1;
}): PrivateScopeHmacPreimageInternalV0_1 {
  if (!isContextIdValue(input.contextId)) throw INPUT_ABORT;
  if (
    input.scope.identifiers.length >
    LINEAGE_LIMITS_V0_1.maximumCanonicalTokens
  ) {
    throw RESOURCE_ABORT;
  }
  let tokens: string[];
  if (input.scope.source === "github") {
    tokens = arrayMap(input.scope.identifiers, (identifier) =>
      canonicalToken(canonicalizeGithubIdentifier(identifier)),
    );
  } else if (input.scope.source === "codex") {
    if (input.scope.identifiers.length !== 1) throw INPUT_ABORT;
    tokens = arrayMap(input.scope.identifiers, (identifier) =>
      canonicalToken(canonicalizeCodexIdentifier(identifier)),
    );
  } else {
    tokens = arrayMap(input.scope.identifiers, (identifier) =>
      canonicalToken(canonicalizeNotionIdentifier(identifier)),
    );
  }
  arraySortStrings(tokens);
  if (
    !isSortedUniqueAscii(tokens) &&
    tokens.length > 1
  ) {
    throw INPUT_ABORT;
  }
  if (
    arraySome(
      tokens,
      (token) =>
        !regexTest(/^[A-Za-z0-9_-]+$/u, token) ||
        stringNormalize(token) !== token ||
        typedArrayByteLength(textEncode(token)) >
          LINEAGE_LIMITS_V0_1.maximumCanonicalTokenUtf8Bytes,
    )
  ) {
    throw INPUT_ABORT;
  }
  const preimage = deepFreezeLineageInternalV0_1({
    domain: PRIVATE_SCOPE_HMAC_DOMAIN_V0_1,
    contextId: input.contextId,
    source: input.scope.source,
    scopeKind: input.scope.scopeKind,
    tokenCanonicalizationVersion:
      SCOPE_TOKEN_CANONICALIZATION_VERSION_V0_1,
    canonicalTokens: tokens,
  });
  if (
    typedArrayByteLength(textEncode(jcsCanonicalize(preimage))) >
    LINEAGE_LIMITS_V0_1.maximumPrivateScopeHmacPreimageBytes
  ) {
    throw RESOURCE_ABORT;
  }
  return preimage;
}

export interface RestrictedPrivateScopeHmacHandleInternalV0_1 {
  readonly keyVersion: string;
  readonly computeHmacSha256: (preimage: Uint8Array) => Uint8Array;
}

export function computePrivateScopeHmacSha256InternalV0_1(input: {
  keyVersion: string;
  handle: RestrictedPrivateScopeHmacHandleInternalV0_1;
  preimage: PrivateScopeHmacPreimageInternalV0_1;
}): string {
  if (
    !objectIsFrozen(input.handle) ||
    input.handle.keyVersion !== input.keyVersion ||
    !isBoundedOpaqueVersionValue(input.keyVersion)
  ) {
    throw INPUT_ABORT;
  }
  const preimageBytes = textEncode(jcsCanonicalize(input.preimage));
  let digest: Uint8Array;
  try {
    digest = input.handle.computeHmacSha256(preimageBytes);
  } finally {
    fillUint8Array(preimageBytes, 0);
  }
  if (!isNodeUint8Array(digest)) {
    throw INPUT_ABORT;
  }
  try {
    if (typedArrayByteLength(digest) !== 32) throw INPUT_ABORT;
    const hexadecimalAlphabet = "0123456789abcdef";
    let hexadecimal = "";
    for (let index = 0; index < 32; index += 1) {
      const byte = digest[index]!;
      hexadecimal +=
        hexadecimalAlphabet[(byte >>> 4) & 0x0f] +
        hexadecimalAlphabet[byte & 0x0f];
    }
    return hexadecimal;
  } finally {
    fillUint8Array(digest, 0);
  }
}

export interface PrivateLifecycleRecordInternalV0_1 {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface PrivateContextRegistrationInternalV0_1
  extends PrivateLifecycleRecordInternalV0_1 {
  readonly contextId: string;
  readonly frozenEvaluationCaseId: string;
  readonly authorizedComparisonScope: readonly string[];
  readonly privacyScopeHmacKeyVersion: string;
}

export interface PrivateKeyLifecycleRecordInternalV0_1
  extends PrivateLifecycleRecordInternalV0_1 {
  readonly keyVersion: string;
  readonly deletedAt: string | null;
}

export interface FrozenTimezoneProfileSnapshotInternalV0_1 {
  readonly releaseVersion: typeof TIMEZONE_RELEASE_VERSION_V0_1;
  readonly releaseSha512: typeof TIMEZONE_RELEASE_SHA512_V0_1;
  readonly profileVersion: typeof TIMEZONE_PROFILE_VERSION_V0_1;
  readonly profileSha256: string;
  readonly canonicalZones: readonly string[];
  readonly aliases: readonly Readonly<{
    alias: string;
    canonicalTarget: string;
  }>[];
}

export interface RuntimePrivateVerificationSnapshotInternalV0_1 {
  readonly verificationStartedAt: string;
  readonly contextRegistrations: readonly PrivateContextRegistrationInternalV0_1[];
  readonly keyLifecycleRecords: readonly PrivateKeyLifecycleRecordInternalV0_1[];
  readonly restrictedHmacHandles: readonly RestrictedPrivateScopeHmacHandleInternalV0_1[];
  readonly timezoneProfile: FrozenTimezoneProfileSnapshotInternalV0_1 | null;
}

export type RequiredSourceVerificationPlanEntryV0_1 = Readonly<{
  source: LineageSourceV0_1;
  requestedCollectionMode: string;
  requiredOperations: readonly string[];
  sourceAttestationSchemaVersion: typeof SOURCE_ATTESTATION_SCHEMA_VERSION_V0_1;
  bundlePresent: true;
  authoritativeVerifierStatus: "unavailable";
}>;

export type PlanSourceVerificationInternalResultV0_1 =
  | Readonly<{
      planned: true;
      authoritative: false;
      stageOrder: readonly [
        "intrinsic_receipt",
        "record_set_binding",
        "source_attestation",
      ];
      stageStatus: Readonly<{
        intrinsicReceipt: "inspected";
        recordSetBinding: "not_authoritatively_executed";
        sourceAttestation: "not_required";
      }>;
      requiredSourceVerifications: readonly [];
    }>
  | Readonly<{
      planned: false;
      authoritative: false;
      failedStage: LineageVerificationStageV0_1;
      failureCode: LineageFailureCodeV0_1;
      requiredSourceVerifications?: readonly RequiredSourceVerificationPlanEntryV0_1[];
    }>;

function isOpaqueOrdinaryObject(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !isNodeProxy(value) &&
    applyIntrinsic<object | null>(intrinsicObjectGetPrototypeOf, Object, [
      value,
    ]) === objectPrototype
  );
}

function inspectBundlePresence(
  receipt: CommonSuggestionEvidenceLineageReceiptV0_1,
  bundles: unknown,
):
  | Readonly<{
      ok: true;
      requirements: readonly RequiredSourceVerificationPlanEntryV0_1[];
    }>
  | Readonly<{ ok: false; failureCode: LineageFailureCodeV0_1 }> {
  if (!isOpaqueOrdinaryObject(bundles)) {
    return freezeObject({ ok: false, failureCode: "INPUT_INVALID" });
  }
  const keys = reflectOwnKeys(bundles);
  if (arraySome(keys, (key) => typeof key !== "string")) {
    return freezeObject({ ok: false, failureCode: "INPUT_INVALID" });
  }
  const requested: CommonSuggestionEvidenceLineageReceiptV0_1["sourceCollectionPlan"][number][] = [];
  const requestedSources: LineageSourceV0_1[] = [];
  for (let index = 0; index < receipt.sourceCollectionPlan.length; index += 1) {
    const entry = receipt.sourceCollectionPlan[index]!;
    if (entry.requestStatus === "requested") {
      requested[requested.length] = entry;
      requestedSources[requestedSources.length] = entry.source;
    }
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (
      typeof key !== "string" ||
      !arrayIncludes(LINEAGE_SOURCES_V0_1, key as LineageSourceV0_1)
    ) {
      return freezeObject({ ok: false, failureCode: "SOURCE_BINDING_INVALID" });
    }
    const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      intrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [bundles, key],
    );
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return freezeObject({ ok: false, failureCode: "INPUT_INVALID" });
    }
    if (
      !arrayIncludes(requestedSources, key as LineageSourceV0_1) ||
      !isOpaqueOrdinaryObject(descriptor.value)
    ) {
      return freezeObject({ ok: false, failureCode: "SOURCE_BINDING_INVALID" });
    }
  }
  if (keys.length !== requested.length) {
    return freezeObject({ ok: false, failureCode: "SOURCE_BINDING_INVALID" });
  }
  const requirements: RequiredSourceVerificationPlanEntryV0_1[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const entry = requested[index]!;
    if (!objectHasOwn(bundles, entry.source)) {
      return freezeObject({ ok: false, failureCode: "SOURCE_BINDING_INVALID" });
    }
    arrayPushValue(
      requirements,
      deepFreezeLineageInternalV0_1({
        source: entry.source,
        requestedCollectionMode: entry.requestedCollectionMode!,
        requiredOperations: arraySlice(entry.requiredOperations, 0),
        sourceAttestationSchemaVersion:
          SOURCE_ATTESTATION_SCHEMA_VERSION_V0_1,
        bundlePresent: true,
        authoritativeVerifierStatus: "unavailable",
      }),
    );
  }
  return freezeObject({
    ok: true,
    requirements: deepFreezeLineageInternalV0_1(requirements),
  });
}

export function planSourceVerificationInternalV0_1(
  receiptInput: unknown,
  recordSet: unknown,
  sourceVerificationBundles: unknown,
): PlanSourceVerificationInternalResultV0_1 {
  const intrinsic = inspectReceiptIntrinsicInternalV0_1(receiptInput);
  if (!intrinsic.inspected) {
    return deepFreezeLineageInternalV0_1({
      planned: false,
      authoritative: false,
      failedStage: "intrinsic_receipt",
      failureCode: intrinsic.failureCode,
    });
  }
  if (!isOpaqueOrdinaryObject(recordSet)) {
    return deepFreezeLineageInternalV0_1({
      planned: false,
      authoritative: false,
      failedStage: "record_set_binding",
      failureCode: "INPUT_INVALID",
    });
  }
  const bundleInspection = inspectBundlePresence(
    intrinsic.receipt,
    sourceVerificationBundles,
  );
  if (!bundleInspection.ok) {
    return deepFreezeLineageInternalV0_1({
      planned: false,
      authoritative: false,
      failedStage: "source_attestation",
      failureCode: bundleInspection.failureCode,
    });
  }
  if (bundleInspection.requirements.length > 0) {
    return deepFreezeLineageInternalV0_1({
      planned: false,
      authoritative: false,
      failedStage: "source_attestation",
      failureCode: "SOURCE_VERIFIER_UNAVAILABLE",
      requiredSourceVerifications: bundleInspection.requirements,
    });
  }
  return deepFreezeLineageInternalV0_1({
    planned: true,
    authoritative: false,
    stageOrder: [
      "intrinsic_receipt",
      "record_set_binding",
      "source_attestation",
    ],
    stageStatus: {
      intrinsicReceipt: "inspected",
      recordSetBinding: "not_authoritatively_executed",
      sourceAttestation: "not_required",
    },
    requiredSourceVerifications: [],
  });
}
