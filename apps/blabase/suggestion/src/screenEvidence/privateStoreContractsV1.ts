import { z } from "zod";

import {
  SCREEN_EVIDENCE_LIMITS_V1,
  SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
  type ScreenEvidenceConflictV1,
  type ScreenEvidenceIssueV1,
  type ScreenEvidenceObservationV1,
} from "./contractsV1";

export const PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1 =
  "blabase.private-screen-evidence-capture-revision.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1 =
  "blabase.private-screen-evidence-store-snapshot.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_SELECTION_SCHEMA_V1 =
  "blabase.private-screen-evidence-export-selection.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_CLEANUP_INVENTORY_SCHEMA_V1 =
  "blabase.private-screen-evidence-cleanup-inventory.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_RETENTION_POLICY_V1 =
  "blabase.private-screen-evidence-retention.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_PRIVACY_REVIEW_RECEIPT_SCHEMA_V1 =
  "blabase.private-screen-evidence-privacy-review-receipt.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1 =
  "blabase.privacy-minimized-screen-evidence.v1" as const;
export const PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1 =
  "blabase.capture-store.v1" as const;

export const PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1 =
  ".local/screen-evidence/v1/store" as const;
export const PRIVATE_SCREEN_EVIDENCE_EXPORTS_RELATIVE_DIRECTORY_V1 =
  ".local/screen-evidence/v1/exports" as const;

export const PRIVATE_SCREEN_EVIDENCE_LIMITS_V1 = Object.freeze({
  recordBytes: 1024 * 1024,
  snapshotBytes: 32 * 1024 * 1024,
  records: SCREEN_EVIDENCE_LIMITS_V1.captures,
  observationsPerRecord: 5_000,
  directoryEntries: 20_000,
  inventoryEntries: 50_000,
  conflictsPerRecord: 1_000,
  issuesPerRecord: 1_000,
  maximumDepth: SCREEN_EVIDENCE_LIMITS_V1.maximumDepth,
  maximumObjectProperties: SCREEN_EVIDENCE_LIMITS_V1.maximumObjectProperties,
  maximumArrayElements: SCREEN_EVIDENCE_LIMITS_V1.maximumArrayElements,
  maximumStringBytes: SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes,
  maximumGraphNodes: 100_000,
} as const);

export type PrivateScreenEvidenceExportIneligibilityReasonV1 =
  | "AUTHORIZATION_EXCLUDES_EXPORT"
  | "PRIVACY_REVIEW_REQUIRED"
  | "PROCESSING_INCOMPLETE"
  | "SOURCE_CONFLICT"
  | "RETENTION_EXPIRED";

export type PrivateScreenEvidenceExportEligibilityV1 =
  | Readonly<{
      status: "eligible";
      reasonCodes: readonly [];
    }>
  | Readonly<{
      status: "ineligible";
      reasonCodes: readonly PrivateScreenEvidenceExportIneligibilityReasonV1[];
    }>;

export interface PrivateScreenEvidenceRetentionPolicyV1 {
  readonly policyVersion: typeof PRIVATE_SCREEN_EVIDENCE_RETENTION_POLICY_V1;
  readonly retainUntilEpochMs: number;
  readonly disposition: "delete_after_retention" | "retain_under_hold";
}

export interface PrivateScreenEvidenceCaptureRevisionV1 {
  readonly schemaVersion: typeof PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1;
  readonly capture: Readonly<{
    captureId: string;
    revision: number;
    capturedAtEpochMs: number;
  }>;
  readonly provenance: Readonly<{
    sourceSystem: typeof PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1;
    sourceRevision: string;
    authorizationId: string;
    preprocessingVersion: typeof SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1;
    privacyProfile: typeof PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1;
  }>;
  readonly previousRevision: Readonly<{
    revision: number;
    rawSha256: string;
  }> | null;
  readonly observations: readonly ScreenEvidenceObservationV1[];
  readonly coverage: Readonly<{
    captureCount: 1;
    observationCount: number;
    ocrSpanCount: number;
    coveredCaptureCount: 0 | 1;
    coveredCaptureRatio: 0 | 1;
  }>;
  readonly conflicts: readonly ScreenEvidenceConflictV1[];
  readonly issues: readonly ScreenEvidenceIssueV1[];
  readonly exportEligibility: PrivateScreenEvidenceExportEligibilityV1;
  readonly retentionPolicy: PrivateScreenEvidenceRetentionPolicyV1;
}

export interface PrivateScreenEvidenceRecordRefV1 {
  readonly captureId: string;
  readonly revision: number;
}

export interface StoredPrivateScreenEvidenceCaptureRevisionV1 {
  readonly storageSchemaVersion: "blabase.private-screen-evidence-stored-revision.v1";
  readonly relativePath: string;
  readonly byteLength: number;
  readonly rawSha256: string;
  readonly record: PrivateScreenEvidenceCaptureRevisionV1;
}

export interface PrivateScreenEvidenceStoreSnapshotV1 {
  readonly schemaVersion: typeof PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1;
  readonly storeDirectory: string;
  readonly snapshotIdentitySha256: string;
  readonly records: readonly StoredPrivateScreenEvidenceCaptureRevisionV1[];
}

export interface PrivateScreenEvidencePrivacyReviewReceiptV1 {
  readonly schemaVersion: typeof PRIVATE_SCREEN_EVIDENCE_PRIVACY_REVIEW_RECEIPT_SCHEMA_V1;
  readonly captureId: string;
  readonly revision: number;
  readonly storedRawSha256: string;
  readonly privacyProfile: typeof PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1;
  readonly decision: "approved";
  readonly reviewId: string;
  readonly reviewedAtEpochMs: number;
}

export interface PrivateScreenEvidenceExportSelectionV1 {
  readonly schemaVersion: typeof PRIVATE_SCREEN_EVIDENCE_SELECTION_SCHEMA_V1;
  readonly sourceSnapshotIdentitySha256: string;
  readonly asOfEpochMs: number;
  readonly window: Readonly<{
    startEpochMs: number;
    endEpochMs: number;
  }>;
  readonly records: readonly StoredPrivateScreenEvidenceCaptureRevisionV1[];
  readonly privacyReviewReceipts: readonly PrivateScreenEvidencePrivacyReviewReceiptV1[];
}

export interface PrivateScreenEvidenceCleanupRecordV1 {
  readonly captureId: string;
  readonly revision: number;
  readonly capturedAtEpochMs: number;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly rawSha256: string;
  readonly exportEligibility: PrivateScreenEvidenceExportEligibilityV1;
  readonly retentionPolicy: PrivateScreenEvidenceRetentionPolicyV1;
}

export type PrivateScreenEvidenceOrphanClassificationV1 =
  | "orphan-temporary-file"
  | "orphan-empty-capture-directory"
  | "orphan-empty-revisions-directory";

export type PrivateScreenEvidenceUnsafeClassificationV1 =
  | "unexpected-store-entry"
  | "unsafe-capture-directory"
  | "unexpected-capture-entry"
  | "unsafe-revisions-directory"
  | "unexpected-revision-entry"
  | "unsafe-revision-file"
  | "record-binding-invalid"
  | "inventory-entry-limit-exceeded";

export interface PrivateScreenEvidenceCleanupInventoryV1 {
  readonly schemaVersion: typeof PRIVATE_SCREEN_EVIDENCE_CLEANUP_INVENTORY_SCHEMA_V1;
  readonly storeDirectory: string;
  readonly records: readonly PrivateScreenEvidenceCleanupRecordV1[];
  readonly orphans: readonly Readonly<{
    relativePath: string;
    classification: PrivateScreenEvidenceOrphanClassificationV1;
  }>[];
  readonly unsafeEntries: readonly Readonly<{
    relativePath: string;
    classification: PrivateScreenEvidenceUnsafeClassificationV1;
  }>[];
}

const textEncoder = new TextEncoder();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

const safeUnsignedInteger = z
  .number()
  .finite()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => !Object.is(value, -0));
const positiveSafeInteger = z
  .number()
  .finite()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().regex(idPattern);
const sha256Hex = z.string().regex(sha256Pattern);
const boundedText = (maximumBytes: number) =>
  z
    .string()
    .min(1)
    .refine((value) => textEncoder.encode(value).byteLength <= maximumBytes);
const confidence = z.number().finite().min(0).max(1).refine((value) => !Object.is(value, -0));

const observationBase = {
  observationId: identifier,
  captureId: identifier,
  capturedAtEpochMs: safeUnsignedInteger,
  confidence,
};

const observationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...observationBase,
      kind: z.literal("ocr_span"),
      text: boundedText(SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes),
    })
    .strict(),
  z
    .object({
      ...observationBase,
      kind: z.enum(["application", "screen", "activity"]),
      label: boundedText(512),
    })
    .strict(),
]);

const conflictSchema = z.discriminatedUnion("code", [
  z
    .object({
      code: z.literal("CAPTURE_REVISION_CONFLICT"),
      captureId: identifier,
    })
    .strict(),
  z
    .object({
      code: z.literal("OBSERVATION_CAPTURE_CONFLICT"),
      observationId: identifier,
      captureId: identifier,
    })
    .strict(),
  z
    .object({
      code: z.literal("PREPROCESSING_PROVENANCE_CONFLICT"),
      captureId: identifier,
    })
    .strict(),
]);

const issueSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("OCR_UNAVAILABLE"), captureId: identifier }).strict(),
  z.object({ code: z.literal("CAPTURE_PARTIAL"), captureId: identifier }).strict(),
  z
    .object({
      code: z.literal("OBSERVATION_LOW_CONFIDENCE"),
      observationId: identifier,
      captureId: identifier,
    })
    .strict(),
  z
    .object({
      code: z.literal("CAPTURE_GAP"),
      beforeCaptureId: identifier,
      afterCaptureId: identifier,
    })
    .strict(),
]);

const exportIneligibilityReasonSchema = z.enum([
  "AUTHORIZATION_EXCLUDES_EXPORT",
  "PRIVACY_REVIEW_REQUIRED",
  "PROCESSING_INCOMPLETE",
  "SOURCE_CONFLICT",
  "RETENTION_EXPIRED",
]);

const exportEligibilitySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("eligible"),
      reasonCodes: z.tuple([]),
    })
    .strict(),
  z
    .object({
      status: z.literal("ineligible"),
      reasonCodes: z
        .array(exportIneligibilityReasonSchema)
        .min(1)
        .max(5)
        .refine(
          (reasonCodes) => new Set(reasonCodes).size === reasonCodes.length,
        ),
    })
    .strict(),
]);

export const privateScreenEvidenceCaptureRevisionSchemaV1 = z
  .object({
    schemaVersion: z.literal(PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1),
    capture: z
      .object({
        captureId: identifier,
        revision: positiveSafeInteger,
        capturedAtEpochMs: safeUnsignedInteger,
      })
      .strict(),
    provenance: z
      .object({
        sourceSystem: z.literal(PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1),
        sourceRevision: identifier,
        authorizationId: identifier,
        preprocessingVersion: z.literal(
          SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
        ),
        privacyProfile: z.literal(PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1),
      })
      .strict(),
    previousRevision: z
      .object({ revision: positiveSafeInteger, rawSha256: sha256Hex })
      .strict()
      .nullable(),
    observations: z
      .array(observationSchema)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.observationsPerRecord),
    coverage: z
      .object({
        captureCount: z.literal(1),
        observationCount: safeUnsignedInteger,
        ocrSpanCount: safeUnsignedInteger,
        coveredCaptureCount: z.union([z.literal(0), z.literal(1)]),
        coveredCaptureRatio: z.union([z.literal(0), z.literal(1)]),
      })
      .strict(),
    conflicts: z
      .array(conflictSchema)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.conflictsPerRecord),
    issues: z
      .array(issueSchema)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.issuesPerRecord),
    exportEligibility: exportEligibilitySchema,
    retentionPolicy: z
      .object({
        policyVersion: z.literal(PRIVATE_SCREEN_EVIDENCE_RETENTION_POLICY_V1),
        retainUntilEpochMs: safeUnsignedInteger,
        disposition: z.enum(["delete_after_retention", "retain_under_hold"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.capture.revision === 1 && value.previousRevision !== null) ||
      (value.capture.revision > 1 &&
        (value.previousRevision === null ||
          value.previousRevision.revision !== value.capture.revision - 1))
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }

    const observationIds = new Set<string>();
    let ocrSpanCount = 0;
    for (const observation of value.observations) {
      if (
        observationIds.has(observation.observationId) ||
        observation.captureId !== value.capture.captureId ||
        observation.capturedAtEpochMs !== value.capture.capturedAtEpochMs
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      observationIds.add(observation.observationId);
      if (observation.kind === "ocr_span") ocrSpanCount += 1;
    }
    const covered = value.observations.length === 0 ? 0 : 1;
    if (
      value.coverage.observationCount !== value.observations.length ||
      value.coverage.ocrSpanCount !== ocrSpanCount ||
      value.coverage.coveredCaptureCount !== covered ||
      value.coverage.coveredCaptureRatio !== covered
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }

    const conflictIdentities = new Set<string>();
    for (const conflict of value.conflicts) {
      if (conflict.captureId !== value.capture.captureId) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      if (
        "observationId" in conflict &&
        !observationIds.has(conflict.observationId)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      const identity = JSON.stringify(conflict);
      if (conflictIdentities.has(identity)) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      conflictIdentities.add(identity);
    }

    const issueIdentities = new Set<string>();
    for (const issue of value.issues) {
      if ("captureId" in issue && issue.captureId !== value.capture.captureId) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      if (
        "observationId" in issue &&
        !observationIds.has(issue.observationId)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      if (
        issue.code === "CAPTURE_GAP" &&
        issue.beforeCaptureId === issue.afterCaptureId
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      const identity = JSON.stringify(issue);
      if (issueIdentities.has(identity)) {
        context.addIssue({ code: z.ZodIssueCode.custom });
      }
      issueIdentities.add(identity);
    }
  });

export const storedPrivateScreenEvidenceCaptureRevisionSchemaV1 = z
  .object({
    storageSchemaVersion: z.literal(
      "blabase.private-screen-evidence-stored-revision.v1",
    ),
    relativePath: z.string().min(1).max(512),
    byteLength: positiveSafeInteger.max(
      PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes,
    ),
    rawSha256: sha256Hex,
    record: privateScreenEvidenceCaptureRevisionSchemaV1,
  })
  .strict();

export const privateScreenEvidenceStoreSnapshotSchemaV1 = z
  .object({
    schemaVersion: z.literal(PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1),
    storeDirectory: z.string().min(1).max(16 * 1024),
    snapshotIdentitySha256: sha256Hex,
    records: z
      .array(storedPrivateScreenEvidenceCaptureRevisionSchemaV1)
      .min(1)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.records),
  })
  .strict();

export const privateScreenEvidencePrivacyReviewReceiptSchemaV1 = z
  .object({
    schemaVersion: z.literal(
      PRIVATE_SCREEN_EVIDENCE_PRIVACY_REVIEW_RECEIPT_SCHEMA_V1,
    ),
    captureId: identifier,
    revision: positiveSafeInteger,
    storedRawSha256: sha256Hex,
    privacyProfile: z.literal(PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1),
    decision: z.literal("approved"),
    reviewId: identifier,
    reviewedAtEpochMs: safeUnsignedInteger,
  })
  .strict();

export const privateScreenEvidenceExportSelectionSchemaV1 = z
  .object({
    schemaVersion: z.literal(PRIVATE_SCREEN_EVIDENCE_SELECTION_SCHEMA_V1),
    sourceSnapshotIdentitySha256: sha256Hex,
    asOfEpochMs: safeUnsignedInteger,
    window: z
      .object({
        startEpochMs: safeUnsignedInteger,
        endEpochMs: safeUnsignedInteger,
      })
      .strict(),
    records: z
      .array(storedPrivateScreenEvidenceCaptureRevisionSchemaV1)
      .min(1)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.records),
    privacyReviewReceipts: z
      .array(privateScreenEvidencePrivacyReviewReceiptSchemaV1)
      .min(1)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.records),
  })
  .strict();
