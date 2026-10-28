import { createHash } from "node:crypto";

import {
  SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
  SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
  SCREEN_EVIDENCE_LIMITS_V1,
  SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
  SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
  SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
  type ScreenEvidenceBundleEntryV1,
  type ScreenEvidenceBundleInputV1,
  type ScreenEvidenceConflictV1,
  type ScreenEvidenceIssueV1,
  type ScreenEvidenceManifestV1,
  type ScreenEvidenceObservationV1,
  type ScreenEvidencePayloadV1,
} from "./contractsV1";
import {
  importScreenEvidenceBundleV1,
} from "./importScreenEvidenceBundleV1";
import {
  PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1,
  PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1,
  privateScreenEvidenceExportSelectionSchemaV1,
  type PrivateScreenEvidenceExportSelectionV1,
  type StoredPrivateScreenEvidenceCaptureRevisionV1,
} from "./privateStoreContractsV1";
import {
  canonicalPrivateScreenEvidenceJsonBytesV1,
  deepFreezePrivateScreenEvidenceV1,
  PrivateScreenEvidenceFilesystemErrorV1,
  snapshotStrictPrivateScreenEvidenceJsonV1,
} from "./privateScreenEvidenceFilesystemV1.internal";
import {
  type ReadScreenEvidenceBundleV1Result,
} from "./readScreenEvidenceBundleV1";
import {
  PrivateScreenEvidencePublicationErrorV1,
  publishScreenEvidenceBundleV1Internal,
} from "./publishScreenEvidenceBundleV1.internal";

const objectFreeze = Object.freeze;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const SCREEN_EVIDENCE_EXPORT_BUILD_SCHEMA_VERSION_V1 =
  "blabase.screen-evidence-export-build.v1" as const;
export const SCREEN_EVIDENCE_EXPORT_PUBLICATION_SCHEMA_VERSION_V1 =
  "blabase.screen-evidence-export-publication.v1" as const;

export type ScreenEvidenceExportIssueCodeV1 =
  | "EXPORT_INPUT_INVALID"
  | "SELECTION_INVALID"
  | "REFERENCE_INVALID"
  | "ORDER_INVALID"
  | "COVERAGE_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "BUNDLE_PREFLIGHT_REJECTED"
  | "EXPORT_RUN_EXISTS"
  | "EXPORT_DIRECTORY_UNSAFE"
  | "EXPORT_WRITE_REJECTED"
  | "POST_COMPLETE_FAILURE"
  | "FINAL_READBACK_REJECTED";

export class ScreenEvidenceExportErrorV1 extends Error {
  readonly issueCode: ScreenEvidenceExportIssueCodeV1;

  constructor(issueCode: ScreenEvidenceExportIssueCodeV1) {
    super(`Screen evidence export failed (${issueCode})`);
    this.name = "ScreenEvidenceExportErrorV1";
    this.issueCode = issueCode;
  }
}

export interface BuildScreenEvidenceBundleV1Input {
  readonly exportRunId: string;
  readonly selection: PrivateScreenEvidenceExportSelectionV1;
}

export interface PublishScreenEvidenceBundleV1Input {
  readonly projectDirectory: string;
  readonly bundle: ScreenEvidenceBundleInputV1;
}

export interface PublishedScreenEvidenceBundleV1 {
  readonly publicationSchemaVersion: typeof SCREEN_EVIDENCE_EXPORT_PUBLICATION_SCHEMA_VERSION_V1;
  readonly bundleDirectory: string;
  readonly readback: ReadScreenEvidenceBundleV1Result;
}

function fail(issueCode: ScreenEvidenceExportIssueCodeV1): never {
  throw new ScreenEvidenceExportErrorV1(issueCode);
}

function mapFilesystemError(error: PrivateScreenEvidenceFilesystemErrorV1): never {
  switch (error.issueCode) {
    case "ENTRY_EXISTS":
      return fail("EXPORT_RUN_EXISTS");
    case "RESOURCE_LIMIT_EXCEEDED":
      return fail("RESOURCE_LIMIT_EXCEEDED");
    case "DIRECTORY_UNSAFE":
    case "FILE_UNSAFE":
      return fail("EXPORT_DIRECTORY_UNSAFE");
    case "INPUT_INVALID":
      return fail("EXPORT_INPUT_INVALID");
    default:
      return fail("EXPORT_WRITE_REJECTED");
  }
}

function compareCapture(
  left: StoredPrivateScreenEvidenceCaptureRevisionV1,
  right: StoredPrivateScreenEvidenceCaptureRevisionV1,
): number {
  const a = left.record.capture;
  const b = right.record.capture;
  if (a.capturedAtEpochMs !== b.capturedAtEpochMs) {
    return a.capturedAtEpochMs < b.capturedAtEpochMs ? -1 : 1;
  }
  return a.captureId < b.captureId ? -1 : a.captureId > b.captureId ? 1 : 0;
}

function compareObservation(
  left: ScreenEvidenceObservationV1,
  right: ScreenEvidenceObservationV1,
): number {
  if (left.capturedAtEpochMs !== right.capturedAtEpochMs) {
    return left.capturedAtEpochMs < right.capturedAtEpochMs ? -1 : 1;
  }
  return left.observationId < right.observationId
    ? -1
    : left.observationId > right.observationId
      ? 1
      : 0;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function recordCanonicalBinding(
  stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
): void {
  const recordBytes = canonicalPrivateScreenEvidenceJsonBytesV1(stored.record);
  const expectedHash = createHash("sha256").update(recordBytes).digest("hex");
  const captureHash = createHash("sha256")
    .update(stored.record.capture.captureId, "utf8")
    .digest("hex");
  const expectedPath = `captures/${captureHash}/revisions/${stored.record.capture.revision}.json`;
  if (
    stored.relativePath !== expectedPath ||
    stored.byteLength !== recordBytes.byteLength ||
    stored.rawSha256 !== expectedHash
  ) {
    return fail("SELECTION_INVALID");
  }
}

function sourceRevision(
  records: readonly StoredPrivateScreenEvidenceCaptureRevisionV1[],
): string {
  const hash = createHash("sha256");
  hash.update("blabase.screen-evidence-source-revision.v1\0", "utf8");
  for (const stored of records) {
    const descriptor = canonicalPrivateScreenEvidenceJsonBytesV1({
      byteLength: stored.byteLength,
      captureId: stored.record.capture.captureId,
      rawSha256: stored.rawSha256,
      revision: stored.record.capture.revision,
    });
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(descriptor.byteLength), false);
    hash.update(length);
    hash.update(descriptor);
  }
  return hash.digest("hex");
}

function frozenBundleEntry(
  relativePath: ScreenEvidenceBundleEntryV1["relativePath"],
  bytes: Uint8Array,
): ScreenEvidenceBundleEntryV1 {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return objectFreeze({
    relativePath,
    entryKind: "regular-file" as const,
    byteLength: owned.byteLength,
    bytes: owned,
  });
}

function bundleFromPayloadAndManifest(
  payload: ScreenEvidencePayloadV1,
  manifest: ScreenEvidenceManifestV1,
): ScreenEvidenceBundleInputV1 {
  const payloadBytes = canonicalPrivateScreenEvidenceJsonBytesV1(payload);
  const manifestBytes = canonicalPrivateScreenEvidenceJsonBytesV1(manifest);
  const manifestSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  const markerBytes = new TextEncoder().encode(manifestSha256);
  return objectFreeze({
    bundleDirectoryName: payload.exportRunId,
    entries: objectFreeze([
      frozenBundleEntry("payload.json", payloadBytes),
      frozenBundleEntry("manifest.json", manifestBytes),
      frozenBundleEntry("manifest.sha256", markerBytes),
      frozenBundleEntry("COMPLETE", markerBytes),
    ]),
  });
}

export function buildScreenEvidenceBundleV1(
  input: BuildScreenEvidenceBundleV1Input,
): ScreenEvidenceBundleInputV1 {
  try {
    const boundary = snapshotStrictPrivateScreenEvidenceJsonV1(input);
    if (
      boundary === null ||
      typeof boundary !== "object" ||
      Array.isArray(boundary)
    ) {
      return fail("EXPORT_INPUT_INVALID");
    }
    const candidate = boundary as Record<string, unknown>;
    if (
      Reflect.ownKeys(candidate).length !== 2 ||
      typeof candidate.exportRunId !== "string" ||
      !idPattern.test(candidate.exportRunId)
    ) {
      return fail("EXPORT_INPUT_INVALID");
    }
    const selectionResult = privateScreenEvidenceExportSelectionSchemaV1.safeParse(
      candidate.selection,
    );
    if (!selectionResult.success) return fail("SELECTION_INVALID");
    const selection = selectionResult.data as PrivateScreenEvidenceExportSelectionV1;
    if (
      selection.window.endEpochMs < selection.window.startEpochMs ||
      selection.records.length === 0
    ) {
      return fail("SELECTION_INVALID");
    }

    const records = [...selection.records].sort(compareCapture);
    const captureIds = new Set<string>();
    const receiptByCaptureId = new Map(
      selection.privacyReviewReceipts.map((receipt) => [
        receipt.captureId,
        receipt,
      ]),
    );
    const receiptCaptureIds = new Set<string>();
    const receiptReviewIds = new Set<string>();
    for (const receipt of selection.privacyReviewReceipts) {
      if (
        receiptCaptureIds.has(receipt.captureId) ||
        receiptReviewIds.has(receipt.reviewId) ||
        receipt.reviewedAtEpochMs > selection.asOfEpochMs
      ) {
        return fail("SELECTION_INVALID");
      }
      receiptCaptureIds.add(receipt.captureId);
      receiptReviewIds.add(receipt.reviewId);
    }
    if (selection.privacyReviewReceipts.length !== records.length) {
      return fail("SELECTION_INVALID");
    }
    for (let index = 0; index < records.length; index += 1) {
      const stored = records[index]!;
      recordCanonicalBinding(stored);
      const capture = stored.record.capture;
      const receipt = receiptByCaptureId.get(capture.captureId);
      const retentionSelectable =
        stored.record.retentionPolicy.disposition === "retain_under_hold" ||
        selection.asOfEpochMs < stored.record.retentionPolicy.retainUntilEpochMs;
      if (
        stored.record.exportEligibility.status !== "eligible" ||
        capture.capturedAtEpochMs < selection.window.startEpochMs ||
        capture.capturedAtEpochMs > selection.window.endEpochMs ||
        captureIds.has(capture.captureId) ||
        !retentionSelectable ||
        receipt === undefined ||
        receipt.revision !== capture.revision ||
        receipt.storedRawSha256 !== stored.rawSha256 ||
        receipt.privacyProfile !== stored.record.provenance.privacyProfile ||
        receipt.decision !== "approved"
      ) {
        return fail("SELECTION_INVALID");
      }
      if (index > 0 && compareCapture(records[index - 1]!, stored) >= 0) {
        return fail("ORDER_INVALID");
      }
      captureIds.add(capture.captureId);
    }
    if (records.length > SCREEN_EVIDENCE_LIMITS_V1.captures) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }

    const observations = records
      .flatMap((stored) => [...stored.record.observations])
      .sort(compareObservation);
    const observationIds = new Set<string>();
    const observationCapture = new Map<string, string>();
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index]!;
      if (
        observationIds.has(observation.observationId) ||
        !captureIds.has(observation.captureId)
      ) {
        return fail("REFERENCE_INVALID");
      }
      if (
        index > 0 &&
        compareObservation(observations[index - 1]!, observation) >= 0
      ) {
        return fail("ORDER_INVALID");
      }
      observationIds.add(observation.observationId);
      observationCapture.set(observation.observationId, observation.captureId);
    }
    if (observations.length > SCREEN_EVIDENCE_LIMITS_V1.observations) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }

    const captures = records.map((stored) => ({ ...stored.record.capture }));
    const captureIndex = new Map(
      captures.map((capture, index) => [capture.captureId, index]),
    );
    const conflicts = records
      .flatMap((stored) => [...stored.record.conflicts])
      .sort((left, right) =>
        compareCodeUnits(JSON.stringify(left), JSON.stringify(right)),
      );
    const conflictIdentities = new Set<string>();
    for (const conflict of conflicts) {
      const identity = JSON.stringify(conflict);
      if (
        conflictIdentities.has(identity) ||
        !captureIds.has(conflict.captureId) ||
        ("observationId" in conflict &&
          observationCapture.get(conflict.observationId) !== conflict.captureId)
      ) {
        return fail("REFERENCE_INVALID");
      }
      conflictIdentities.add(identity);
    }
    if (conflicts.length > SCREEN_EVIDENCE_LIMITS_V1.conflicts) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }

    const issues = records
      .flatMap((stored) => [...stored.record.issues])
      .sort((left, right) =>
        compareCodeUnits(JSON.stringify(left), JSON.stringify(right)),
      );
    const issueIdentities = new Set<string>();
    for (const issue of issues) {
      const identity = JSON.stringify(issue);
      if (issueIdentities.has(identity)) return fail("REFERENCE_INVALID");
      if ("captureId" in issue && !captureIds.has(issue.captureId)) {
        return fail("REFERENCE_INVALID");
      }
      if (
        "observationId" in issue &&
        observationCapture.get(issue.observationId) !== issue.captureId
      ) {
        return fail("REFERENCE_INVALID");
      }
      if (issue.code === "CAPTURE_GAP") {
        const before = captureIndex.get(issue.beforeCaptureId);
        const after = captureIndex.get(issue.afterCaptureId);
        if (before === undefined || after === undefined || before >= after) {
          return fail("REFERENCE_INVALID");
        }
      }
      issueIdentities.add(identity);
    }
    if (issues.length > SCREEN_EVIDENCE_LIMITS_V1.issues) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }

    const coveredCaptureIds = new Set(
      observations.map((observation) => observation.captureId),
    );
    const ocrSpanCount = observations.filter(
      (observation) => observation.kind === "ocr_span",
    ).length;
    const payload: ScreenEvidencePayloadV1 = deepFreezePrivateScreenEvidenceV1({
      schemaVersion: SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
      producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
      preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
      exportRunId: candidate.exportRunId,
      window: {
        startEpochMs: selection.window.startEpochMs,
        endEpochMs: selection.window.endEpochMs,
      },
      provenance: {
        sourceSystem: PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1,
        sourceRevision: sourceRevision(records),
        preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
        privacyProfile: PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1,
      },
      captures,
      observations,
      coverage: {
        captureCount: captures.length,
        observationCount: observations.length,
        ocrSpanCount,
        coveredCaptureCount: coveredCaptureIds.size,
        coveredCaptureRatio: coveredCaptureIds.size / captures.length,
      },
      conflicts: conflicts as ScreenEvidenceConflictV1[],
      issues: issues as ScreenEvidenceIssueV1[],
    });
    const payloadBytes = canonicalPrivateScreenEvidenceJsonBytesV1(payload);
    if (payloadBytes.byteLength > SCREEN_EVIDENCE_LIMITS_V1.payloadBytes) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    const manifest: ScreenEvidenceManifestV1 = deepFreezePrivateScreenEvidenceV1({
      schemaVersion: SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
      canonicalizationProfile: SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
      producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
      preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
      exportRunId: candidate.exportRunId,
      payloadFile: "payload.json",
      payloadByteCount: payloadBytes.byteLength,
      payloadSha256: createHash("sha256").update(payloadBytes).digest("hex"),
    });
    if (
      canonicalPrivateScreenEvidenceJsonBytesV1(manifest).byteLength >
      SCREEN_EVIDENCE_LIMITS_V1.manifestBytes
    ) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    const bundle = bundleFromPayloadAndManifest(payload, manifest);
    try {
      importScreenEvidenceBundleV1(bundle);
    } catch {
      return fail("BUNDLE_PREFLIGHT_REJECTED");
    }
    return bundle;
  } catch (error) {
    if (error instanceof ScreenEvidenceExportErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("EXPORT_INPUT_INVALID");
  }
}

export async function publishScreenEvidenceBundleV1(
  input: PublishScreenEvidenceBundleV1Input,
): Promise<PublishedScreenEvidenceBundleV1> {
  try {
    return await publishScreenEvidenceBundleV1Internal(input);
  } catch (error) {
    if (error instanceof ScreenEvidenceExportErrorV1) throw error;
    if (error instanceof PrivateScreenEvidencePublicationErrorV1) {
      return fail(error.issueCode);
    }
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("EXPORT_WRITE_REJECTED");
  }
}

void SCREEN_EVIDENCE_EXPORT_BUILD_SCHEMA_VERSION_V1;
