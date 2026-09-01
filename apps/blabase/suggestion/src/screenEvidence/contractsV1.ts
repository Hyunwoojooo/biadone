export const SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1 =
  "blabase.screen-evidence-bundle.v1" as const;
export const SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1 =
  "blabase.screen-evidence-manifest.v1" as const;
export const SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1 =
  "blabase.screen-evidence-producer.v1" as const;
export const SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1 =
  "blabase.screen-evidence-preprocessing.v1" as const;
export const SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1 =
  "rfc8785.jcs.v1" as const;

export const SCREEN_EVIDENCE_BUNDLE_FILES_V1 = Object.freeze([
  "payload.json",
  "manifest.json",
  "manifest.sha256",
  "COMPLETE",
] as const);

export const SCREEN_EVIDENCE_LIMITS_V1 = Object.freeze({
  payloadBytes: 5 * 1024 * 1024,
  manifestBytes: 16 * 1024,
  markerBytes: 64,
  captures: 10_000,
  observations: 50_000,
  conflicts: 10_000,
  issues: 10_000,
  maximumDepth: 16,
  maximumObjectProperties: 64,
  maximumArrayElements: 50_000,
  maximumStringBytes: 16 * 1024,
} as const);

export type ScreenEvidenceBundleFileV1 =
  (typeof SCREEN_EVIDENCE_BUNDLE_FILES_V1)[number];

export type ScreenEvidenceObservationKindV1 =
  | "ocr_span"
  | "application"
  | "screen"
  | "activity";

export interface ScreenEvidenceCaptureV1 {
  readonly captureId: string;
  readonly revision: number;
  readonly capturedAtEpochMs: number;
}

export interface ScreenEvidenceOcrSpanObservationV1 {
  readonly observationId: string;
  readonly captureId: string;
  readonly capturedAtEpochMs: number;
  readonly kind: "ocr_span";
  readonly text: string;
  readonly confidence: number;
}

export interface ScreenEvidenceLabelObservationV1 {
  readonly observationId: string;
  readonly captureId: string;
  readonly capturedAtEpochMs: number;
  readonly kind: "application" | "screen" | "activity";
  readonly label: string;
  readonly confidence: number;
}

export type ScreenEvidenceObservationV1 =
  | ScreenEvidenceOcrSpanObservationV1
  | ScreenEvidenceLabelObservationV1;

export type ScreenEvidenceConflictV1 =
  | Readonly<{
      code: "CAPTURE_REVISION_CONFLICT";
      captureId: string;
    }>
  | Readonly<{
      code: "OBSERVATION_CAPTURE_CONFLICT";
      observationId: string;
      captureId: string;
    }>
  | Readonly<{
      code: "PREPROCESSING_PROVENANCE_CONFLICT";
      captureId: string;
    }>;

export type ScreenEvidenceIssueV1 =
  | Readonly<{
      code: "OCR_UNAVAILABLE";
      captureId: string;
    }>
  | Readonly<{
      code: "CAPTURE_PARTIAL";
      captureId: string;
    }>
  | Readonly<{
      code: "OBSERVATION_LOW_CONFIDENCE";
      observationId: string;
      captureId: string;
    }>
  | Readonly<{
      code: "CAPTURE_GAP";
      beforeCaptureId: string;
      afterCaptureId: string;
    }>;

export interface ScreenEvidencePayloadV1 {
  readonly schemaVersion: typeof SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1;
  readonly producerIdentity: typeof SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1;
  readonly preprocessingVersion: typeof SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1;
  readonly exportRunId: string;
  readonly window: Readonly<{
    startEpochMs: number;
    endEpochMs: number;
  }>;
  readonly provenance: Readonly<{
    sourceSystem: "blabase.capture-store.v1";
    sourceRevision: string;
    preprocessingVersion: typeof SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1;
    privacyProfile: "blabase.privacy-minimized-screen-evidence.v1";
  }>;
  readonly captures: readonly ScreenEvidenceCaptureV1[];
  readonly observations: readonly ScreenEvidenceObservationV1[];
  readonly coverage: Readonly<{
    captureCount: number;
    observationCount: number;
    ocrSpanCount: number;
    coveredCaptureCount: number;
    coveredCaptureRatio: number;
  }>;
  readonly conflicts: readonly ScreenEvidenceConflictV1[];
  readonly issues: readonly ScreenEvidenceIssueV1[];
}

export interface ScreenEvidenceManifestV1 {
  readonly schemaVersion: typeof SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1;
  readonly canonicalizationProfile: typeof SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1;
  readonly producerIdentity: typeof SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1;
  readonly preprocessingVersion: typeof SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1;
  readonly exportRunId: string;
  readonly payloadFile: "payload.json";
  readonly payloadByteCount: number;
  readonly payloadSha256: string;
}

export interface ScreenEvidenceBundleEntryV1 {
  readonly relativePath: ScreenEvidenceBundleFileV1;
  readonly entryKind: "regular-file";
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

export interface ScreenEvidenceBundleInputV1 {
  readonly bundleDirectoryName: string;
  readonly entries: readonly ScreenEvidenceBundleEntryV1[];
}

export interface QualifiedScreenEvidenceDescriptorV1 {
  readonly qualificationSchemaVersion: "blabase.screen-evidence-qualification.v1";
  readonly exportRunId: string;
  readonly manifestByteCount: number;
  readonly manifestSha256: string;
  readonly payloadByteCount: number;
  readonly payloadSha256: string;
  readonly replayIdentitySha256: string;
}

export interface QualifiedScreenEvidenceBundleV1 {
  readonly descriptor: QualifiedScreenEvidenceDescriptorV1;
  readonly manifest: ScreenEvidenceManifestV1;
  readonly evidence: ScreenEvidencePayloadV1;
}
