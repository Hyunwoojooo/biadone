import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  boundedJsonUnsignedIntegerSchema,
  dayflowCoverageSchema,
  dayflowCoverageStructuralSchema,
  domainSeparatedSha256,
  identifierSchema,
  jcsCanonicalize,
  schemaVersionSchema,
  sha256HexSchema,
  sourceArtifactRefSchema,
  utcTimestampSchema,
} from "./contracts";

const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectValues = Object.values;

export const DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION =
  "dayflow-preprocessed-evidence-v0.1" as const;
export const DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN =
  "blabase.dayflow-preprocessed-evidence.v0.1" as const;
export const DAYFLOW_PREPROCESSED_EVIDENCE_VERIFIER_VERSION =
  "dayflow-preprocessed-evidence-verifier-v0.1" as const;
export const DAYFLOW_PREPROCESSED_EVIDENCE_IMPORT_SCHEMA_VERSION =
  "dayflow-screen-evidence-bundle-import-v0.1" as const;

export const DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS = Object.freeze({
  canonicalDocumentBytes: 512 * 1024,
  frames: 256,
  spansPerFrame: 32,
  totalSpans: 1_024,
  textBytesPerSpan: 2_048,
  totalTextBytes: 65_536,
  redactionCategoriesPerSpan: 8,
  jsonContainerDepth: 10,
} as const);

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});
const intrinsicReflectApply = Reflect.apply;
const intrinsicUint8Array = Uint8Array;
const intrinsicUint8ArraySet = Uint8Array.prototype.set;
const intrinsicEmptyUint8Array = new Uint8Array(0);
const intrinsicTypedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const intrinsicTypedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "buffer",
)?.get;
const intrinsicTypedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteOffset",
)?.get;
const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  "byteLength",
)?.get;
const intrinsicTypedArrayTagGetter = Object.getOwnPropertyDescriptor(
  intrinsicTypedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const intrinsicArrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const intrinsicArrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;
const forbiddenOcrTextPattern =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function rawUtf8Sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSortedUniqueAscii(values: readonly string[]): boolean {
  return values.every(
    (value, index) =>
      index === 0 || compareAscii(values[index - 1]!, value) < 0,
  );
}

const safeOcrTextSchema = z.string().superRefine((value, context) => {
  const byteLength = encoder.encode(value).byteLength;
  if (
    !isUnicodeScalarString(value) ||
    value.normalize("NFC") !== value ||
    forbiddenOcrTextPattern.test(value) ||
    byteLength < 1 ||
    byteLength > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.textBytesPerSpan
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "OCR text must be NFC scalar text within its UTF-8 byte bound without forbidden controls",
    });
  }
});

const transportBindingSchema = z
  .object({
    importSchemaVersion: z.literal(
      DAYFLOW_PREPROCESSED_EVIDENCE_IMPORT_SCHEMA_VERSION,
    ),
    manifestRawSha256: sha256HexSchema,
    manifestDetachedSha256: sha256HexSchema,
    completionSha256: sha256HexSchema,
    objectCount: boundedJsonUnsignedIntegerSchema(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.frames,
    ),
    totalObjectBytes: boundedJsonUnsignedIntegerSchema(256 * 1024 * 1024),
    replayIdentitySha256: sha256HexSchema,
  })
  .strict();

const exactOcrModelProvenanceSchema = z
  .object({
    execution: z.literal("on_device"),
    provenanceLevel: z.literal("exact_model"),
    engineId: identifierSchema,
    engineVersion: schemaVersionSchema,
    modelId: identifierSchema,
    modelVersion: schemaVersionSchema,
    configurationSha256: sha256HexSchema,
  })
  .strict();

const engineOnlyOcrModelProvenanceSchema = z
  .object({
    execution: z.literal("on_device"),
    provenanceLevel: z.literal("engine_version_only"),
    engineId: identifierSchema,
    engineVersion: schemaVersionSchema,
    modelId: z.null(),
    modelVersion: z.null(),
    configurationSha256: sha256HexSchema,
  })
  .strict();

const ocrModelProvenanceSchema = z.discriminatedUnion("provenanceLevel", [
  exactOcrModelProvenanceSchema,
  engineOnlyOcrModelProvenanceSchema,
]);

const preprocessingProvenanceSchema = z
  .object({
    runId: identifierSchema,
    pipelineVersion: schemaVersionSchema,
    pipelineBuildSha256: sha256HexSchema,
    privacyPolicyVersion: schemaVersionSchema,
    privacyPolicySha256: sha256HexSchema,
    completedAt: utcTimestampSchema,
    ocr: ocrModelProvenanceSchema,
  })
  .strict();

const reportedConfidenceSchema = z
  .object({
    status: z.literal("reported"),
    basisPoints: boundedJsonUnsignedIntegerSchema(10_000),
  })
  .strict();

const unavailableConfidenceSchema = z
  .object({
    status: z.literal("unavailable"),
    basisPoints: z.null(),
  })
  .strict();

const ocrConfidenceSchema = z.discriminatedUnion("status", [
  reportedConfidenceSchema,
  unavailableConfidenceSchema,
]);

const redactionCategorySchema = z.enum([
  "credential",
  "email",
  "phone",
  "person",
  "account_id",
  "filesystem_path",
  "url",
  "other_sensitive",
]);

const noneDetectedRedactionSchema = z
  .object({
    status: z.literal("none_detected"),
    categories: z.array(redactionCategorySchema).length(0),
  })
  .strict();

const redactedSchema = z
  .object({
    status: z.literal("redacted"),
    categories: z
      .array(redactionCategorySchema)
      .min(1)
      .max(
        DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.redactionCategoriesPerSpan,
      ),
  })
  .strict();

const redactionSchema = z
  .discriminatedUnion("status", [
    noneDetectedRedactionSchema,
    redactedSchema,
  ])
  .superRefine((value, context) => {
    if (
      value.status === "redacted" &&
      !isSortedUniqueAscii(value.categories)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categories"],
        message: "Redaction categories must be ASCII-sorted and unique",
      });
    }
  });

const privacyFilteredOcrSpanSchema = z
  .object({
    spanOrdinal: boundedJsonUnsignedIntegerSchema(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.spansPerFrame - 1,
    ),
    textKind: z.literal("privacy_filtered_ocr"),
    text: safeOcrTextSchema,
    textSha256: sha256HexSchema,
    confidence: ocrConfidenceSchema,
    redaction: redactionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.textSha256 !== rawUtf8Sha256(value.text)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["textSha256"],
        message: "OCR text hash mismatch",
      });
    }
  });

const emptySpansSchema = z.array(privacyFilteredOcrSpanSchema).length(0);
const textFrameResultSchema = z
  .object({
    status: z.literal("text"),
    spans: z
      .array(privacyFilteredOcrSpanSchema)
      .min(1)
      .max(DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.spansPerFrame),
  })
  .strict();
const noTextFrameResultSchema = z
  .object({ status: z.literal("no_text"), spans: emptySpansSchema })
  .strict();
const privacyOmittedFrameResultSchema = z
  .object({
    status: z.literal("privacy_omitted"),
    spans: emptySpansSchema,
    omissionCode: z.literal("PRIVACY_POLICY_EXCLUDED"),
  })
  .strict();
const failedFrameResultSchema = z
  .object({
    status: z.literal("processing_failed"),
    spans: emptySpansSchema,
    errorCode: z.enum([
      "OCR_FAILED",
      "PRIVACY_FILTER_FAILED",
      "UNSUPPORTED_FRAME",
      "RESOURCE_LIMIT",
    ]),
    retryability: z.enum(["retryable", "terminal"]),
  })
  .strict();
const frameProcessingResultSchema = z.discriminatedUnion("status", [
  textFrameResultSchema,
  noTextFrameResultSchema,
  privacyOmittedFrameResultSchema,
  failedFrameResultSchema,
]);

const frameEvidenceSchema = z
  .object({
    frameOrdinal: boundedJsonUnsignedIntegerSchema(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.frames - 1,
    ),
    sourceArtifactRef: sourceArtifactRefSchema,
    capturedAt: utcTimestampSchema,
    result: frameProcessingResultSchema,
  })
  .strict();

const captureWindowSchema = z
  .object({ start: utcTimestampSchema, end: utcTimestampSchema })
  .strict()
  .superRefine((value, context) => {
    if (value.start >= value.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "Capture window must be non-empty",
      });
    }
  });

const rootShape = {
  schemaVersion: z.literal(DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION),
  dataOrigin: z.literal("synthetic"),
  studyPhase: z.literal("contract_conformance"),
  studyProtocolHash: sha256HexSchema,
  transportBinding: transportBindingSchema,
  preprocessing: preprocessingProvenanceSchema,
  captureWindow: captureWindowSchema,
  coverageCode: z.enum(["observed", "valid-empty", "failure"]),
  coverage: dayflowCoverageSchema,
  frames: z
    .array(frameEvidenceSchema)
    .max(DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.frames),
} as const;

const rootPreimageObjectSchema = z.object(rootShape).strict();
type RootPreimage = z.infer<typeof rootPreimageObjectSchema>;

function sourceRefKey(
  value: z.infer<typeof sourceArtifactRefSchema>,
): string {
  return [
    value.exportRef.exportId,
    value.sourceRowId,
    value.blobSha256,
  ].join("\u0000");
}

function refineRoot(value: RootPreimage, context: z.RefinementCtx): void {
  if (value.preprocessing.completedAt < value.captureWindow.end) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["preprocessing", "completedAt"],
      message: "Preprocessing cannot complete before the capture window ends",
    });
  }
  if (value.frames.length !== value.transportBinding.objectCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["frames"],
      message: "Frame count must equal the imported object count",
    });
  }
  if (
    value.coverageCode === "valid-empty" &&
    (value.transportBinding.objectCount !== 0 || value.frames.length !== 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["coverageCode"],
      message: "Valid-empty evidence must contain zero objects and frames",
    });
  }
  if (
    value.coverageCode === "observed" &&
    value.transportBinding.objectCount === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["coverageCode"],
      message: "Observed evidence requires at least one object",
    });
  }
  if (value.coverageCode === "failure") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["coverageCode"],
      message: "Failure coverage cannot be sealed as evidence",
    });
  }

  let previousCapturedAt: string | null = null;
  let totalSpans = 0;
  let totalTextBytes = 0;
  const sourceRefs = new Set<string>();
  const exportIds = new Set<string>();
  value.frames.forEach((frame, frameIndex) => {
    if (frame.frameOrdinal !== frameIndex) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", frameIndex, "frameOrdinal"],
        message: "Frame ordinals must be contiguous",
      });
    }
    if (
      frame.capturedAt < value.captureWindow.start ||
      frame.capturedAt >= value.captureWindow.end
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", frameIndex, "capturedAt"],
        message: "Frame timestamp must be inside the half-open capture window",
      });
    }
    if (
      previousCapturedAt !== null &&
      frame.capturedAt < previousCapturedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", frameIndex, "capturedAt"],
        message: "Frame timestamps must be nondecreasing",
      });
    }
    previousCapturedAt = frame.capturedAt;
    if (
      frame.sourceArtifactRef.exportRef.detachedManifestSha256 !==
      value.transportBinding.manifestDetachedSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", frameIndex, "sourceArtifactRef", "exportRef"],
        message: "Source manifest hash must match the transport binding",
      });
    }
    const key = sourceRefKey(frame.sourceArtifactRef);
    if (sourceRefs.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frames", frameIndex, "sourceArtifactRef"],
        message: "Source artifact references must be unique",
      });
    }
    sourceRefs.add(key);
    exportIds.add(frame.sourceArtifactRef.exportRef.exportId);
    frame.result.spans.forEach((span, spanIndex) => {
      if (span.spanOrdinal !== spanIndex) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "frames",
            frameIndex,
            "result",
            "spans",
            spanIndex,
            "spanOrdinal",
          ],
          message: "Span ordinals must be contiguous",
        });
      }
      totalSpans += 1;
      totalTextBytes += encoder.encode(span.text).byteLength;
    });
  });
  if (exportIds.size > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["frames"],
      message: "All source artifacts must belong to one export",
    });
  }
  if (totalSpans > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.totalSpans) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["frames"],
      message: "Total OCR span count exceeds the contract limit",
    });
  }
  if (totalTextBytes > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.totalTextBytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["frames"],
      message: "Total OCR text bytes exceed the contract limit",
    });
  }
}

export const dayflowPreprocessedEvidenceV0_1PreimageSchema =
  rootPreimageObjectSchema.superRefine(refineRoot);

const fullObjectSchema = z
  .object({
    ...rootShape,
    dayflowPreprocessedEvidenceSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => refineRoot(value, context));

const resolutionOcrModelProvenanceSchema = z
  .object({
    execution: z.literal("on_device"),
    provenanceLevel: z.enum(["exact_model", "engine_version_only"]),
    engineId: identifierSchema,
    engineVersion: schemaVersionSchema,
    modelId: z.union([identifierSchema, z.null()]),
    modelVersion: z.union([schemaVersionSchema, z.null()]),
    configurationSha256: sha256HexSchema,
  })
  .strict();

const resolutionPreprocessingSchema = z
  .object({
    runId: identifierSchema,
    pipelineVersion: schemaVersionSchema,
    pipelineBuildSha256: sha256HexSchema,
    privacyPolicyVersion: schemaVersionSchema,
    privacyPolicySha256: sha256HexSchema,
    completedAt: utcTimestampSchema,
    ocr: resolutionOcrModelProvenanceSchema,
  })
  .strict();

const resolutionConfidenceSchema = z
  .object({
    status: z.enum(["reported", "unavailable"]),
    basisPoints: z.union([
      boundedJsonUnsignedIntegerSchema(10_000),
      z.null(),
    ]),
  })
  .strict();

const resolutionRedactionSchema = z
  .object({
    status: z.enum(["none_detected", "redacted"]),
    categories: z
      .array(redactionCategorySchema)
      .max(
        DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.redactionCategoriesPerSpan,
      ),
  })
  .strict();

const resolutionSpanSchema = z
  .object({
    spanOrdinal: boundedJsonUnsignedIntegerSchema(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.spansPerFrame - 1,
    ),
    textKind: z.literal("privacy_filtered_ocr"),
    text: z.string(),
    textSha256: sha256HexSchema,
    confidence: resolutionConfidenceSchema,
    redaction: resolutionRedactionSchema,
  })
  .strict();

const resolutionSpansSchema = z
  .array(resolutionSpanSchema)
  .max(DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.spansPerFrame);

const resolutionFrameResultSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("text"), spans: resolutionSpansSchema })
    .strict(),
  z
    .object({ status: z.literal("no_text"), spans: resolutionSpansSchema })
    .strict(),
  z
    .object({
      status: z.literal("privacy_omitted"),
      spans: resolutionSpansSchema,
      omissionCode: z.literal("PRIVACY_POLICY_EXCLUDED"),
    })
    .strict(),
  z
    .object({
      status: z.literal("processing_failed"),
      spans: resolutionSpansSchema,
      errorCode: z.enum([
        "OCR_FAILED",
        "PRIVACY_FILTER_FAILED",
        "UNSUPPORTED_FRAME",
        "RESOURCE_LIMIT",
      ]),
      retryability: z.enum(["retryable", "terminal"]),
    })
    .strict(),
]);

const resolutionFrameSchema = z
  .object({
    frameOrdinal: boundedJsonUnsignedIntegerSchema(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.frames - 1,
    ),
    sourceArtifactRef: sourceArtifactRefSchema,
    capturedAt: utcTimestampSchema,
    result: resolutionFrameResultSchema,
  })
  .strict();

const resolutionRootShape = {
  schemaVersion: z.literal(DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION),
  dataOrigin: z.literal("synthetic"),
  studyPhase: z.literal("contract_conformance"),
  studyProtocolHash: sha256HexSchema,
  transportBinding: transportBindingSchema,
  preprocessing: resolutionPreprocessingSchema,
  captureWindow: z
    .object({ start: utcTimestampSchema, end: utcTimestampSchema })
    .strict(),
  coverageCode: z.enum(["observed", "valid-empty", "failure"]),
  coverage: dayflowCoverageStructuralSchema,
  frames: z
    .array(resolutionFrameSchema)
    .max(DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.frames),
} as const;

const resolutionPreimageStructuralSchema = z
  .object(resolutionRootShape)
  .strict();
const resolutionFullStructuralSchema = z
  .object({
    ...resolutionRootShape,
    dayflowPreprocessedEvidenceSha256: sha256HexSchema,
  })
  .strict();
type ResolutionStructuralPreimage = z.infer<
  typeof resolutionPreimageStructuralSchema
>;

export type DayflowPreprocessedEvidenceDeferredIssueCodeV0_1 =
  | "CAPTURE_WINDOW_MISMATCH"
  | "CHRONOLOGY_INVALID"
  | "PREPROCESSING_PROVENANCE_INVALID"
  | "OCR_TEXT_INVALID"
  | "OCR_TEXT_HASH_MISMATCH"
  | "PRIVACY_METADATA_INVALID"
  | "RESOURCE_COUNT_MISMATCH";

export type DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1 =
  | "COVERAGE"
  | "SOURCE_ARTIFACT_BINDING"
  | "SOURCE_ARTIFACT_SET";

type CollectedSemanticIssues = Readonly<{
  fullSchemaInvalid: boolean;
  deferredIssueCodes: readonly DayflowPreprocessedEvidenceDeferredIssueCodeV0_1[];
  deferredResolvedOwners: readonly DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1[];
}>;

function collectSemanticIssues(
  candidate: ResolutionStructuralPreimage,
): CollectedSemanticIssues {
  const {
    dayflowPreprocessedEvidenceSha256: detachedRootHash,
    ...value
  } = candidate as ResolutionStructuralPreimage & {
    readonly dayflowPreprocessedEvidenceSha256?: string;
  };
  void detachedRootHash;

  const deferredIssueCodes =
    new Set<DayflowPreprocessedEvidenceDeferredIssueCodeV0_1>();
  const deferredResolvedOwners =
    new Set<DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1>();
  let fullSchemaInvalid = false;
  const invalidate = (
    issueCode?: DayflowPreprocessedEvidenceDeferredIssueCodeV0_1,
  ): void => {
    fullSchemaInvalid = true;
    if (issueCode !== undefined) deferredIssueCodes.add(issueCode);
  };
  const deferToResolvedOwner = (
    owner: DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1,
  ): void => {
    fullSchemaInvalid = true;
    deferredResolvedOwners.add(owner);
  };

  if (!rootPreimageObjectSchema.safeParse(value).success) invalidate();
  if (value.captureWindow.start >= value.captureWindow.end) {
    invalidate("CAPTURE_WINDOW_MISMATCH");
  }
  if (value.preprocessing.completedAt < value.captureWindow.end) {
    invalidate("CHRONOLOGY_INVALID");
  }
  const ocr = value.preprocessing.ocr;
  if (
    (ocr.provenanceLevel === "exact_model" &&
      (ocr.modelId === null || ocr.modelVersion === null)) ||
    (ocr.provenanceLevel === "engine_version_only" &&
      (ocr.modelId !== null || ocr.modelVersion !== null))
  ) {
    invalidate("PREPROCESSING_PROVENANCE_INVALID");
  }
  if (value.frames.length !== value.transportBinding.objectCount) {
    invalidate("RESOURCE_COUNT_MISMATCH");
  }
  if (
    value.coverageCode === "valid-empty" &&
    (value.transportBinding.objectCount !== 0 || value.frames.length !== 0)
  ) {
    deferToResolvedOwner("COVERAGE");
  }
  if (
    value.coverageCode === "observed" &&
    value.transportBinding.objectCount === 0
  ) {
    deferToResolvedOwner("COVERAGE");
  }
  if (value.coverageCode === "failure") deferToResolvedOwner("COVERAGE");
  if (!dayflowCoverageSchema.safeParse(value.coverage).success) {
    deferToResolvedOwner("COVERAGE");
  }

  let previousCapturedAt: string | null = null;
  let totalSpans = 0;
  let totalTextBytes = 0;
  const sourceRefs = new Set<string>();
  const exportIds = new Set<string>();
  value.frames.forEach((frame, frameIndex) => {
    if (frame.frameOrdinal !== frameIndex) {
      invalidate("CHRONOLOGY_INVALID");
    }
    if (
      frame.capturedAt < value.captureWindow.start ||
      frame.capturedAt >= value.captureWindow.end
    ) {
      invalidate("CAPTURE_WINDOW_MISMATCH");
    }
    if (
      previousCapturedAt !== null &&
      frame.capturedAt < previousCapturedAt
    ) {
      invalidate("CHRONOLOGY_INVALID");
    }
    previousCapturedAt = frame.capturedAt;
    if (
      frame.sourceArtifactRef.exportRef.detachedManifestSha256 !==
      value.transportBinding.manifestDetachedSha256
    ) {
      deferToResolvedOwner("SOURCE_ARTIFACT_BINDING");
    }
    const sourceKey = sourceRefKey(frame.sourceArtifactRef);
    if (sourceRefs.has(sourceKey)) {
      deferToResolvedOwner("SOURCE_ARTIFACT_SET");
    }
    sourceRefs.add(sourceKey);
    exportIds.add(frame.sourceArtifactRef.exportRef.exportId);
    if (
      (frame.result.status === "text" &&
        frame.result.spans.length === 0) ||
      (frame.result.status !== "text" &&
        frame.result.spans.length !== 0)
    ) {
      invalidate("OCR_TEXT_INVALID");
    }
    frame.result.spans.forEach((span, spanIndex) => {
      if (span.spanOrdinal !== spanIndex) {
        invalidate("CHRONOLOGY_INVALID");
      }
      totalSpans += 1;
      const textByteLength = encoder.encode(span.text).byteLength;
      totalTextBytes += textByteLength;
      if (
        !isUnicodeScalarString(span.text) ||
        span.text.normalize("NFC") !== span.text ||
        forbiddenOcrTextPattern.test(span.text) ||
        textByteLength < 1 ||
        textByteLength >
          DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.textBytesPerSpan
      ) {
        invalidate("OCR_TEXT_INVALID");
      }
      if (span.textSha256 !== rawUtf8Sha256(span.text)) {
        invalidate("OCR_TEXT_HASH_MISMATCH");
      }
      if (
        (span.confidence.status === "reported" &&
          span.confidence.basisPoints === null) ||
        (span.confidence.status === "unavailable" &&
          span.confidence.basisPoints !== null)
      ) {
        invalidate("OCR_TEXT_INVALID");
      }
      if (
        (span.redaction.status === "none_detected" &&
          span.redaction.categories.length !== 0) ||
        (span.redaction.status === "redacted" &&
          (span.redaction.categories.length === 0 ||
            !isSortedUniqueAscii(span.redaction.categories)))
      ) {
        invalidate("PRIVACY_METADATA_INVALID");
      }
    });
  });
  if (exportIds.size > 1) {
    deferToResolvedOwner("SOURCE_ARTIFACT_BINDING");
  }
  if (totalSpans > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.totalSpans) {
    invalidate();
  }
  if (totalTextBytes > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.totalTextBytes) {
    invalidate();
  }

  return intrinsicObjectFreeze({
    fullSchemaInvalid,
    deferredIssueCodes: intrinsicObjectFreeze(
      [...deferredIssueCodes].sort(compareAscii),
    ),
    deferredResolvedOwners: intrinsicObjectFreeze(
      [...deferredResolvedOwners].sort(compareAscii),
    ),
  });
}

export const dayflowPreprocessedEvidenceV0_1Schema =
  fullObjectSchema.superRefine((value, context) => {
    const {
      dayflowPreprocessedEvidenceSha256: _ignored,
      ...preimage
    } = value;
    if (
      value.dayflowPreprocessedEvidenceSha256 !==
      domainSeparatedSha256(
        DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
        preimage,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayflowPreprocessedEvidenceSha256"],
        message: "Preprocessed evidence hash mismatch",
      });
    }
  });

export type DayflowPreprocessedEvidenceV0_1Preimage = z.infer<
  typeof dayflowPreprocessedEvidenceV0_1PreimageSchema
>;
export type DayflowPreprocessedEvidenceV0_1 = z.infer<
  typeof dayflowPreprocessedEvidenceV0_1Schema
>;

export type DayflowPreprocessedEvidenceCoreIssueCode =
  | "INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "JSON_INVALID"
  | "JSON_DUPLICATE_KEY"
  | "JSON_NOT_CANONICAL"
  | "SCHEMA_INVALID"
  | "HASH_MISMATCH";

export class DayflowPreprocessedEvidenceCoreError extends Error {
  readonly issueCode: DayflowPreprocessedEvidenceCoreIssueCode;

  constructor(issueCode: DayflowPreprocessedEvidenceCoreIssueCode) {
    super("Dayflow preprocessed evidence core failed (" + issueCode + ")");
    this.name = "DayflowPreprocessedEvidenceCoreError";
    this.issueCode = issueCode;
  }
}

function deepFreeze<T>(value: T): T {
  if (
    value !== null &&
    typeof value === "object" &&
    !intrinsicObjectIsFrozen(value)
  ) {
    for (const child of intrinsicObjectValues(
      value as Record<string, unknown>,
    )) {
      deepFreeze(child);
    }
    intrinsicObjectFreeze(value);
  }
  return value;
}

function boundedCanonicalFullDocumentBytes(
  value: DayflowPreprocessedEvidenceV0_1,
): Uint8Array {
  const canonicalDocument = jcsCanonicalize(value) + "\n";
  if (
    Buffer.byteLength(canonicalDocument, "utf8") >
    DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  return encoder.encode(canonicalDocument);
}

export function dayflowPreprocessedEvidenceSha256(
  value: DayflowPreprocessedEvidenceV0_1Preimage,
): string {
  const parsed = dayflowPreprocessedEvidenceV0_1PreimageSchema.parse(value);
  return domainSeparatedSha256(
    DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
    parsed,
  );
}

export function sealDayflowPreprocessedEvidenceV0_1(
  value: DayflowPreprocessedEvidenceV0_1Preimage,
): DayflowPreprocessedEvidenceV0_1 {
  const parsed = dayflowPreprocessedEvidenceV0_1PreimageSchema.parse(value);
  const sealed = dayflowPreprocessedEvidenceV0_1Schema.parse({
    ...parsed,
    dayflowPreprocessedEvidenceSha256:
      dayflowPreprocessedEvidenceSha256(parsed),
  });
  boundedCanonicalFullDocumentBytes(sealed);
  return deepFreeze(sealed);
}

export function serializeDayflowPreprocessedEvidenceV0_1(
  value: DayflowPreprocessedEvidenceV0_1,
): Uint8Array {
  const parsed = dayflowPreprocessedEvidenceV0_1Schema.parse(value);
  return boundedCanonicalFullDocumentBytes(parsed);
}

type StrictJsonIssueCode = "DUPLICATE_JSON_KEY" | "INVALID_JSON";

class StrictJsonError extends SyntaxError {
  readonly issueCode: StrictJsonIssueCode;

  constructor(issueCode: StrictJsonIssueCode) {
    super("Strict duplicate-aware JSON parse failed");
    this.issueCode = issueCode;
  }
}

type StrictJsonValidationFrame =
  | {
      kind: "object";
      keys: Set<string>;
      state: "keyOrEnd" | "key" | "colon" | "value" | "commaOrEnd";
    }
  | {
      kind: "array";
      state: "valueOrEnd" | "value" | "commaOrEnd";
    };

type StrictJsonValidationResult = {
  hasDuplicateKey: boolean;
  maxContainerDepth: number;
};

class StrictJsonValidator {
  private index = 0;
  private hasDuplicateKey = false;
  private maxContainerDepth = 0;

  constructor(private readonly text: string) {}

  validate(): StrictJsonValidationResult {
    const stack: StrictJsonValidationFrame[] = [];
    this.skipWhitespace();
    this.scanValue(stack);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      this.skipWhitespace();

      if (frame.kind === "object") {
        if (frame.state === "keyOrEnd" && this.text[this.index] === "}") {
          this.index += 1;
          stack.pop();
          continue;
        }
        if (frame.state === "keyOrEnd" || frame.state === "key") {
          if (this.text[this.index] !== '"') this.fail();
          const key = this.scanString();
          if (frame.keys.has(key)) this.hasDuplicateKey = true;
          frame.keys.add(key);
          frame.state = "colon";
          continue;
        }
        if (frame.state === "colon") {
          if (this.text[this.index] !== ":") this.fail();
          this.index += 1;
          frame.state = "value";
          continue;
        }
        if (frame.state === "value") {
          frame.state = "commaOrEnd";
          this.scanValue(stack);
          continue;
        }
        const delimiter = this.text[this.index];
        if (delimiter === "}") {
          this.index += 1;
          stack.pop();
          continue;
        }
        if (delimiter !== ",") this.fail();
        this.index += 1;
        frame.state = "key";
        continue;
      }

      if (frame.state === "valueOrEnd" && this.text[this.index] === "]") {
        this.index += 1;
        stack.pop();
        continue;
      }
      if (frame.state === "valueOrEnd" || frame.state === "value") {
        frame.state = "commaOrEnd";
        this.scanValue(stack);
        continue;
      }
      const delimiter = this.text[this.index];
      if (delimiter === "]") {
        this.index += 1;
        stack.pop();
        continue;
      }
      if (delimiter !== ",") this.fail();
      this.index += 1;
      frame.state = "value";
    }

    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail();
    return {
      hasDuplicateKey: this.hasDuplicateKey,
      maxContainerDepth: this.maxContainerDepth,
    };
  }

  private scanValue(stack: StrictJsonValidationFrame[]): void {
    const token = this.text[this.index];
    if (token === "{") {
      this.index += 1;
      stack.push({
        kind: "object",
        keys: new Set<string>(),
        state: "keyOrEnd",
      });
      this.maxContainerDepth = Math.max(
        this.maxContainerDepth,
        stack.length,
      );
      return;
    }
    if (token === "[") {
      this.index += 1;
      stack.push({ kind: "array", state: "valueOrEnd" });
      this.maxContainerDepth = Math.max(
        this.maxContainerDepth,
        stack.length,
      );
      return;
    }
    if (token === '"') {
      this.scanString();
      return;
    }
    if (token === "t") {
      this.scanLiteral("true");
      return;
    }
    if (token === "f") {
      this.scanLiteral("false");
      return;
    }
    if (token === "n") {
      this.scanLiteral("null");
      return;
    }
    if (token === "-" || (token !== undefined && /[0-9]/u.test(token))) {
      this.scanNumber();
      return;
    }
    this.fail();
  }

  private scanString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const token = this.text[this.index]!;
      if (token === "\\") {
        this.index += 2;
        continue;
      }
      if (token === '"') {
        this.index += 1;
        try {
          const value: unknown = JSON.parse(
            this.text.slice(start, this.index),
          );
          if (typeof value !== "string") this.fail();
          return value;
        } catch {
          return this.fail();
        }
      }
      if (token.charCodeAt(0) <= 0x1f) this.fail();
      this.index += 1;
    }
    return this.fail();
  }

  private scanLiteral(literal: string): void {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      this.fail();
    }
    this.index += literal.length;
  }

  private scanNumber(): void {
    const match =
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
        this.text.slice(this.index),
      );
    if (match === null) this.fail();
    this.index += match[0].length;
    const delimiter = this.text[this.index];
    if (
      delimiter !== undefined &&
      delimiter !== " " &&
      delimiter !== "\t" &&
      delimiter !== "\n" &&
      delimiter !== "\r" &&
      delimiter !== "," &&
      delimiter !== "]" &&
      delimiter !== "}"
    ) {
      this.fail();
    }
    if (!Number.isFinite(Number(match[0]))) this.fail();
  }

  private skipWhitespace(): void {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\t" ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r"
    ) {
      this.index += 1;
    }
  }

  private fail(): never {
    throw new StrictJsonError("INVALID_JSON");
  }
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("INVALID_JSON");
    return value;
  }

  private fail(issueCode: StrictJsonIssueCode): never {
    throw new StrictJsonError(issueCode);
  }

  private skipWhitespace(): void {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\t" ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r"
    ) {
      this.index += 1;
    }
  }

  private parseValue(): unknown {
    const token = this.text[this.index];
    if (token === "{") return this.parseObject();
    if (token === "[") return this.parseArray();
    if (token === '"') return this.parseString();
    if (token === "t") return this.parseLiteral("true", true);
    if (token === "f") return this.parseLiteral("false", false);
    if (token === "n") return this.parseLiteral("null", null);
    if (token === "-" || (token !== undefined && /[0-9]/u.test(token))) {
      return this.parseNumber();
    }
    return this.fail("INVALID_JSON");
  }

  private parseObject(): Record<string, unknown> {
    this.index += 1;
    this.skipWhitespace();
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      if (this.text[this.index] !== '"') this.fail("INVALID_JSON");
      const key = this.parseString();
      if (keys.has(key)) this.fail("DUPLICATE_JSON_KEY");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("INVALID_JSON");
      this.index += 1;
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: this.parseValue(),
        writable: true,
      });
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") this.fail("INVALID_JSON");
      this.index += 1;
      this.skipWhitespace();
    }
    return this.fail("INVALID_JSON");
  }

  private parseArray(): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") this.fail("INVALID_JSON");
      this.index += 1;
      this.skipWhitespace();
    }
    return this.fail("INVALID_JSON");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const token = this.text[this.index]!;
      if (token === "\\") {
        this.index += 2;
        continue;
      }
      if (token === '"') {
        this.index += 1;
        try {
          const value: unknown = JSON.parse(
            this.text.slice(start, this.index),
          );
          if (typeof value !== "string") this.fail("INVALID_JSON");
          return value;
        } catch {
          return this.fail("INVALID_JSON");
        }
      }
      if (token.charCodeAt(0) <= 0x1f) this.fail("INVALID_JSON");
      this.index += 1;
    }
    return this.fail("INVALID_JSON");
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      return this.fail("INVALID_JSON");
    }
    this.index += literal.length;
    return value;
  }

  private parseNumber(): number {
    const match =
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
        this.text.slice(this.index),
      );
    if (match === null) return this.fail("INVALID_JSON");
    this.index += match[0].length;
    const delimiter = this.text[this.index];
    if (
      delimiter !== undefined &&
      delimiter !== " " &&
      delimiter !== "\t" &&
      delimiter !== "\n" &&
      delimiter !== "\r" &&
      delimiter !== "," &&
      delimiter !== "]" &&
      delimiter !== "}"
    ) {
      return this.fail("INVALID_JSON");
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.fail("INVALID_JSON");
    return value;
  }
}

function fail(issueCode: DayflowPreprocessedEvidenceCoreIssueCode): never {
  throw new DayflowPreprocessedEvidenceCoreError(issueCode);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function containerDepth(value: unknown, depth = 1): number {
  if (value === null || typeof value !== "object") return depth;
  const children = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  return children.reduce(
    (maximum, child) =>
      child !== null && typeof child === "object"
        ? Math.max(maximum, containerDepth(child, depth + 1))
        : maximum,
    depth,
  );
}

function requireRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertDecodedResourceCaps(value: unknown): void {
  if (
    containerDepth(value) >
    DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.jsonContainerDepth
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  const root = requireRecord(value);
  const frames = root?.frames;
  if (!Array.isArray(frames)) return;
  if (frames.length > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.frames) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  let totalSpans = 0;
  let totalTextBytes = 0;
  for (const frameValue of frames) {
    const frame = requireRecord(frameValue);
    const result = requireRecord(frame?.result);
    const spans = result?.spans;
    if (!Array.isArray(spans)) continue;
    if (
      spans.length >
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.spansPerFrame
    ) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    totalSpans += spans.length;
    if (totalSpans > DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.totalSpans) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    for (const spanValue of spans) {
      const span = requireRecord(spanValue);
      if (typeof span?.text === "string") {
        const bytes = encoder.encode(span.text).byteLength;
        if (
          bytes >
          DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.textBytesPerSpan
        ) {
          return fail("RESOURCE_LIMIT_EXCEEDED");
        }
        totalTextBytes += bytes;
        if (
          totalTextBytes >
          DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.totalTextBytes
        ) {
          return fail("RESOURCE_LIMIT_EXCEEDED");
        }
      }
      const redaction = requireRecord(span?.redaction);
      if (
        Array.isArray(redaction?.categories) &&
        redaction.categories.length >
          DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS
            .redactionCategoriesPerSpan
      ) {
        return fail("RESOURCE_LIMIT_EXCEEDED");
      }
    }
  }
}

function snapshotCandidateBytes(value: unknown): Uint8Array {
  if (
    intrinsicTypedArrayBufferGetter === undefined ||
    intrinsicTypedArrayByteOffsetGetter === undefined ||
    intrinsicTypedArrayByteLengthGetter === undefined ||
    intrinsicTypedArrayTagGetter === undefined ||
    intrinsicArrayBufferByteLengthGetter === undefined
  ) {
    return fail("INPUT_INVALID");
  }

  let buffer: unknown;
  let byteOffset: number;
  let byteLength: number;
  try {
    if (
      intrinsicReflectApply(intrinsicTypedArrayTagGetter, value, []) !==
      "Uint8Array"
    ) {
      return fail("INPUT_INVALID");
    }
    buffer = intrinsicReflectApply(
      intrinsicTypedArrayBufferGetter,
      value,
      [],
    );
    byteOffset = intrinsicReflectApply(
      intrinsicTypedArrayByteOffsetGetter,
      value,
      [],
    ) as number;
    byteLength = intrinsicReflectApply(
      intrinsicTypedArrayByteLengthGetter,
      value,
      [],
    ) as number;
  } catch {
    return fail("INPUT_INVALID");
  }

  try {
    intrinsicReflectApply(intrinsicArrayBufferByteLengthGetter, buffer, []);
    intrinsicReflectApply(intrinsicUint8ArraySet, value, [
      intrinsicEmptyUint8Array,
    ]);
    if (
      intrinsicArrayBufferResizableGetter !== undefined &&
      intrinsicReflectApply(intrinsicArrayBufferResizableGetter, buffer, []) ===
        true
    ) {
      return fail("INPUT_INVALID");
    }
  } catch {
    return fail("INPUT_INVALID");
  }

  if (
    byteLength >
    DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }

  try {
    intrinsicReflectApply(intrinsicArrayBufferByteLengthGetter, buffer, []);
    if (
      intrinsicArrayBufferResizableGetter !== undefined &&
      intrinsicReflectApply(intrinsicArrayBufferResizableGetter, buffer, []) ===
        true
    ) {
      return fail("INPUT_INVALID");
    }
    const source = new intrinsicUint8Array(
      buffer as ArrayBuffer,
      byteOffset,
      byteLength,
    );
    const snapshot = new intrinsicUint8Array(byteLength);
    intrinsicReflectApply(intrinsicUint8ArraySet, snapshot, [source]);
    return snapshot;
  } catch {
    return fail("INPUT_INVALID");
  }
}

function parseCanonicalCandidateValue(
  candidateBytes: Uint8Array,
): unknown {
  const snapshot = snapshotCandidateBytes(candidateBytes);
  if (
    snapshot[0] === 0xef &&
    snapshot[1] === 0xbb &&
    snapshot[2] === 0xbf
  ) {
    return fail("JSON_INVALID");
  }
  let text: string;
  try {
    text = fatalDecoder.decode(snapshot);
  } catch {
    return fail("JSON_INVALID");
  }
  let value: unknown;
  let validation: StrictJsonValidationResult;
  try {
    validation = new StrictJsonValidator(text).validate();
  } catch {
    return fail("JSON_INVALID");
  }
  if (validation.hasDuplicateKey) return fail("JSON_DUPLICATE_KEY");
  if (
    validation.maxContainerDepth >
    DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.jsonContainerDepth
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  try {
    value = new StrictJsonParser(text).parse();
  } catch (error) {
    if (
      error instanceof StrictJsonError &&
      error.issueCode === "DUPLICATE_JSON_KEY"
    ) {
      return fail("JSON_DUPLICATE_KEY");
    }
    return fail("JSON_INVALID");
  }
  assertDecodedResourceCaps(value);

  let canonicalBytes: Uint8Array;
  try {
    canonicalBytes = encoder.encode(jcsCanonicalize(value) + "\n");
  } catch {
    return fail("JSON_INVALID");
  }
  if (!bytesEqual(snapshot, canonicalBytes)) {
    return fail("JSON_NOT_CANONICAL");
  }

  return value;
}

function resolutionRootHashMatches(
  value: z.infer<typeof resolutionFullStructuralSchema>,
): boolean {
  const {
    dayflowPreprocessedEvidenceSha256: expectedHash,
    ...preimage
  } = value;
  return (
    expectedHash ===
    domainSeparatedSha256(
      DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
      preimage,
    )
  );
}

export function parseCanonicalDayflowPreprocessedEvidenceV0_1(
  candidateBytes: Uint8Array,
): DayflowPreprocessedEvidenceV0_1 {
  const value = parseCanonicalCandidateValue(candidateBytes);

  const parsed = fullObjectSchema.safeParse(value);
  if (!parsed.success) return fail("SCHEMA_INVALID");
  const {
    dayflowPreprocessedEvidenceSha256: expectedHash,
    ...preimage
  } = parsed.data;
  const actualHash = domainSeparatedSha256(
    DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
    preimage,
  );
  if (expectedHash !== actualHash) return fail("HASH_MISMATCH");
  return deepFreeze(parsed.data);
}

export type DayflowPreprocessedEvidenceResolvedInspectionV0_1 =
  | Readonly<{
      status: "rejected";
      issueCode: DayflowPreprocessedEvidenceCoreIssueCode;
    }>
  | Readonly<{
      status: "accepted-for-resolution";
      candidate: z.infer<typeof resolutionFullStructuralSchema>;
      deferredIssueCodes: readonly DayflowPreprocessedEvidenceDeferredIssueCodeV0_1[];
      deferredResolvedOwners: readonly DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1[];
    }>;

/** @internal */
export function inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
  ownedCandidateBytes: Uint8Array,
): DayflowPreprocessedEvidenceResolvedInspectionV0_1 {
  try {
    const value = parseCanonicalCandidateValue(ownedCandidateBytes);
    const structural = resolutionFullStructuralSchema.safeParse(value);
    if (!structural.success) {
      return intrinsicObjectFreeze({
        status: "rejected",
        issueCode: "SCHEMA_INVALID",
      });
    }
    if (!resolutionRootHashMatches(structural.data)) {
      return intrinsicObjectFreeze({
        status: "rejected",
        issueCode: "HASH_MISMATCH",
      });
    }
    const semanticIssues = collectSemanticIssues(structural.data);
    if (
      semanticIssues.fullSchemaInvalid &&
      semanticIssues.deferredIssueCodes.length === 0 &&
      semanticIssues.deferredResolvedOwners.length === 0
    ) {
      return intrinsicObjectFreeze({
        status: "rejected",
        issueCode: "SCHEMA_INVALID",
      });
    }
    return intrinsicObjectFreeze({
      status: "accepted-for-resolution",
      candidate: deepFreeze(structural.data),
      deferredIssueCodes: semanticIssues.deferredIssueCodes,
      deferredResolvedOwners: semanticIssues.deferredResolvedOwners,
    });
  } catch (error) {
    const issueCode =
      error instanceof DayflowPreprocessedEvidenceCoreError
        ? error.issueCode
        : "INPUT_INVALID";
    return intrinsicObjectFreeze({ status: "rejected", issueCode });
  }
}
