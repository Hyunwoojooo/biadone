import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

import {
  accumulatePrivateScreenEvidenceBudgetV1,
  PrivateScreenEvidenceBudgetErrorV1,
} from "./privateScreenEvidenceBudgetsV1.internal";
import {
  PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1,
  PRIVATE_SCREEN_EVIDENCE_CLEANUP_INVENTORY_SCHEMA_V1,
  PRIVATE_SCREEN_EVIDENCE_LIMITS_V1,
  PRIVATE_SCREEN_EVIDENCE_SELECTION_SCHEMA_V1,
  PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1,
  privateScreenEvidenceCaptureRevisionSchemaV1,
  privateScreenEvidenceExportSelectionSchemaV1,
  privateScreenEvidencePrivacyReviewReceiptSchemaV1,
  privateScreenEvidenceStoreSnapshotSchemaV1,
  type PrivateScreenEvidenceCaptureRevisionV1,
  type PrivateScreenEvidenceCleanupInventoryV1,
  type PrivateScreenEvidenceCleanupRecordV1,
  type PrivateScreenEvidenceExportSelectionV1,
  type PrivateScreenEvidencePrivacyReviewReceiptV1,
  type PrivateScreenEvidenceRecordRefV1,
  type PrivateScreenEvidenceStoreSnapshotV1,
  type StoredPrivateScreenEvidenceCaptureRevisionV1,
} from "./privateStoreContractsV1";
import {
  canonicalPrivateScreenEvidenceJsonBytesV1,
  deepFreezePrivateScreenEvidenceV1,
  ensurePrivateScreenEvidenceChildDirectoryV1,
  ensurePrivateScreenEvidenceDirectoryChainV1,
  listPrivateScreenEvidenceDirectoryNamesV1,
  parseCanonicalPrivateScreenEvidenceJsonV1,
  PrivateScreenEvidenceFilesystemErrorV1,
  publishImmutablePrivateScreenEvidenceFileV1,
  readStablePrivateScreenEvidenceFileV1,
  requirePrivateScreenEvidenceDirectoryChainV1,
  requirePrivateScreenEvidenceDirectoryV1,
  snapshotStrictPrivateScreenEvidenceJsonV1,
} from "./privateScreenEvidenceFilesystemV1.internal";

const objectFreeze = Object.freeze;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export type PrivateScreenEvidenceStoreIssueCodeV1 =
  | "STORE_INPUT_INVALID"
  | "RECORD_INVALID"
  | "RECORD_NOT_FOUND"
  | "REVISION_EXISTS"
  | "REVISION_CHAIN_INVALID"
  | "RECORD_BINDING_INVALID"
  | "SNAPSHOT_INVALID"
  | "SELECTION_INVALID"
  | "NO_ELIGIBLE_RECORDS"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "STORE_UNSAFE"
  | "STORE_UNSTABLE"
  | "STORE_IO_REJECTED";

export class PrivateScreenEvidenceStoreErrorV1 extends Error {
  readonly issueCode: PrivateScreenEvidenceStoreIssueCodeV1;

  constructor(issueCode: PrivateScreenEvidenceStoreIssueCodeV1) {
    super(`Private screen evidence store operation failed (${issueCode})`);
    this.name = "PrivateScreenEvidenceStoreErrorV1";
    this.issueCode = issueCode;
  }
}

export interface WritePrivateScreenEvidenceCaptureRevisionV1Input {
  readonly projectDirectory: string;
  readonly record: PrivateScreenEvidenceCaptureRevisionV1;
}

export interface ReadPrivateScreenEvidenceCaptureRevisionV1Input {
  readonly projectDirectory: string;
  readonly captureId: string;
  readonly revision: number;
}

export interface ReadPrivateScreenEvidenceStoreSnapshotV1Input {
  readonly projectDirectory: string;
  readonly recordRefs: readonly PrivateScreenEvidenceRecordRefV1[];
}

export interface SelectPrivateScreenEvidenceForExportV1Input {
  readonly snapshot: PrivateScreenEvidenceStoreSnapshotV1;
  readonly asOfEpochMs: number;
  readonly window: Readonly<{
    startEpochMs: number;
    endEpochMs: number;
  }>;
  readonly privacyReviewReceipts: readonly PrivateScreenEvidencePrivacyReviewReceiptV1[];
}

export interface InventoryPrivateScreenEvidenceStoreForCleanupV1Input {
  readonly projectDirectory: string;
}

function fail(issueCode: PrivateScreenEvidenceStoreIssueCodeV1): never {
  throw new PrivateScreenEvidenceStoreErrorV1(issueCode);
}

function mapFilesystemError(error: PrivateScreenEvidenceFilesystemErrorV1): never {
  switch (error.issueCode) {
    case "ENTRY_MISSING":
    case "DIRECTORY_MISSING":
      return fail("RECORD_NOT_FOUND");
    case "ENTRY_EXISTS":
      return fail("REVISION_EXISTS");
    case "RESOURCE_LIMIT_EXCEEDED":
      return fail("RESOURCE_LIMIT_EXCEEDED");
    case "FILE_UNSTABLE":
      return fail("STORE_UNSTABLE");
    case "DIRECTORY_UNSAFE":
    case "FILE_UNSAFE":
      return fail("STORE_UNSAFE");
    case "CANONICAL_JSON_INVALID":
    case "CONTENT_MISMATCH":
      return fail("RECORD_INVALID");
    case "INPUT_INVALID":
      return fail("STORE_INPUT_INVALID");
    case "FILESYSTEM_UNSUPPORTED":
    case "PRECOMMIT_CLEANUP_FAILURE":
    case "ENTRY_COMMITTED_FAILURE":
    case "FILESYSTEM_REJECTED":
      return fail("STORE_IO_REJECTED");
  }
}

function accumulateStoreBudget(
  used: number,
  delta: number,
  trustedLimit: number,
): number {
  try {
    return accumulatePrivateScreenEvidenceBudgetV1(used, delta, trustedLimit);
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceBudgetErrorV1) {
      if (error.issueCode === "RESOURCE_LIMIT_EXCEEDED") {
        return fail("RESOURCE_LIMIT_EXCEEDED");
      }
      return fail("STORE_IO_REJECTED");
    }
    return fail("STORE_IO_REJECTED");
  }
}

const projectInputSchema = z
  .object({ projectDirectory: z.string().min(1).max(16 * 1024) })
  .strict();
const readInputSchema = z
  .object({
    projectDirectory: z.string().min(1).max(16 * 1024),
    captureId: z.string().regex(idPattern),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const snapshotInputSchema = z
  .object({
    projectDirectory: z.string().min(1).max(16 * 1024),
    recordRefs: z
      .array(
        z
          .object({
            captureId: z.string().regex(idPattern),
            revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .min(1)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.records),
  })
  .strict();
const selectionInputSchema = z
  .object({
    snapshot: privateScreenEvidenceStoreSnapshotSchemaV1,
    asOfEpochMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    window: z
      .object({
        startEpochMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        endEpochMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    privacyReviewReceipts: z
      .array(privateScreenEvidencePrivacyReviewReceiptSchemaV1)
      .max(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.records),
  })
  .strict();

function boundarySnapshot(candidate: unknown): unknown {
  try {
    return snapshotStrictPrivateScreenEvidenceJsonV1(candidate);
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("STORE_INPUT_INVALID");
  }
}

function captureDirectoryHash(captureId: string): string {
  return createHash("sha256").update(captureId, "utf8").digest("hex");
}

function relativeRecordPath(captureId: string, revision: number): string {
  return `captures/${captureDirectoryHash(captureId)}/revisions/${revision}.json`;
}

function compareStoredRecords(
  left: StoredPrivateScreenEvidenceCaptureRevisionV1,
  right: StoredPrivateScreenEvidenceCaptureRevisionV1,
): number {
  const leftCapture = left.record.capture;
  const rightCapture = right.record.capture;
  if (leftCapture.capturedAtEpochMs !== rightCapture.capturedAtEpochMs) {
    return leftCapture.capturedAtEpochMs < rightCapture.capturedAtEpochMs ? -1 : 1;
  }
  return leftCapture.captureId < rightCapture.captureId
    ? -1
    : leftCapture.captureId > rightCapture.captureId
      ? 1
      : 0;
}

function parseRecord(candidate: unknown): PrivateScreenEvidenceCaptureRevisionV1 {
  const result = privateScreenEvidenceCaptureRevisionSchemaV1.safeParse(candidate);
  if (!result.success) return fail("RECORD_INVALID");
  const record: PrivateScreenEvidenceCaptureRevisionV1 = result.data;
  return deepFreezePrivateScreenEvidenceV1(record);
}

function parseRecordBytes(bytes: Uint8Array): PrivateScreenEvidenceCaptureRevisionV1 {
  try {
    return parseRecord(parseCanonicalPrivateScreenEvidenceJsonV1(bytes));
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("RECORD_INVALID");
  }
}

function assertStoredBinding(
  stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
): void {
  const canonical = canonicalPrivateScreenEvidenceJsonBytesV1(stored.record);
  const expectedHash = createHash("sha256").update(canonical).digest("hex");
  if (
    stored.relativePath !==
      relativeRecordPath(
        stored.record.capture.captureId,
        stored.record.capture.revision,
      ) ||
    stored.byteLength !== canonical.byteLength ||
    stored.rawSha256 !== expectedHash
  ) {
    return fail("RECORD_BINDING_INVALID");
  }
}

async function readStoredRevision(
  projectDirectory: string,
  captureId: string,
  revision: number,
): Promise<StoredPrivateScreenEvidenceCaptureRevisionV1> {
  const storeDirectory = await requirePrivateScreenEvidenceDirectoryChainV1(
    projectDirectory,
    "store",
  );
  const captureHash = captureDirectoryHash(captureId);
  const captureDirectory = path.join(storeDirectory, "captures", captureHash);
  const revisionsDirectory = path.join(captureDirectory, "revisions");
  await requirePrivateScreenEvidenceDirectoryV1(captureDirectory);
  await requirePrivateScreenEvidenceDirectoryV1(revisionsDirectory);
  const file = await readStablePrivateScreenEvidenceFileV1(
    path.join(revisionsDirectory, `${revision}.json`),
    PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes,
  );
  const record = parseRecordBytes(file.bytes);
  if (
    record.capture.captureId !== captureId ||
    record.capture.revision !== revision ||
    captureDirectoryHash(record.capture.captureId) !== captureHash
  ) {
    return fail("RECORD_BINDING_INVALID");
  }
  return deepFreezePrivateScreenEvidenceV1({
    storageSchemaVersion:
      "blabase.private-screen-evidence-stored-revision.v1" as const,
    relativePath: relativeRecordPath(captureId, revision),
    byteLength: file.byteLength,
    rawSha256: file.rawSha256,
    record,
  });
}

function domainSeparatedDescriptorHash(
  domain: string,
  records: readonly StoredPrivateScreenEvidenceCaptureRevisionV1[],
): string {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
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

export async function writePrivateScreenEvidenceCaptureRevisionV1(
  input: WritePrivateScreenEvidenceCaptureRevisionV1Input,
): Promise<StoredPrivateScreenEvidenceCaptureRevisionV1> {
  try {
    const candidate = boundarySnapshot(input);
    const result = z
      .object({
        projectDirectory: z.string().min(1).max(16 * 1024),
        record: privateScreenEvidenceCaptureRevisionSchemaV1,
      })
      .strict()
      .safeParse(candidate);
    if (!result.success) return fail("STORE_INPUT_INVALID");
    const projectDirectory = result.data.projectDirectory;
    const record = parseRecord(result.data.record);
    const bytes = canonicalPrivateScreenEvidenceJsonBytesV1(record);
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes
    ) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }

    if (record.capture.revision > 1) {
      const previous = record.previousRevision;
      if (previous === null) return fail("REVISION_CHAIN_INVALID");
      let storedPrevious: StoredPrivateScreenEvidenceCaptureRevisionV1;
      try {
        storedPrevious = await readStoredRevision(
          projectDirectory,
          record.capture.captureId,
          previous.revision,
        );
      } catch (error) {
        if (error instanceof PrivateScreenEvidenceStoreErrorV1) {
          return fail("REVISION_CHAIN_INVALID");
        }
        if (
          error instanceof PrivateScreenEvidenceFilesystemErrorV1 &&
          (error.issueCode === "ENTRY_MISSING" ||
            error.issueCode === "DIRECTORY_MISSING")
        ) {
          return fail("REVISION_CHAIN_INVALID");
        }
        throw error;
      }
      if (storedPrevious.rawSha256 !== previous.rawSha256) {
        return fail("REVISION_CHAIN_INVALID");
      }
    }

    const storeDirectory = await ensurePrivateScreenEvidenceDirectoryChainV1(
      projectDirectory,
      "store",
    );
    const capturesDirectory = await ensurePrivateScreenEvidenceChildDirectoryV1(
      storeDirectory,
      "captures",
    );
    const captureDirectory = await ensurePrivateScreenEvidenceChildDirectoryV1(
      capturesDirectory,
      captureDirectoryHash(record.capture.captureId),
    );
    const revisionsDirectory = await ensurePrivateScreenEvidenceChildDirectoryV1(
      captureDirectory,
      "revisions",
    );
    const published = await publishImmutablePrivateScreenEvidenceFileV1(
      revisionsDirectory,
      `${record.capture.revision}.json`,
      bytes,
    );
    const stored = deepFreezePrivateScreenEvidenceV1({
      storageSchemaVersion:
        "blabase.private-screen-evidence-stored-revision.v1" as const,
      relativePath: relativeRecordPath(
        record.capture.captureId,
        record.capture.revision,
      ),
      byteLength: published.byteLength,
      rawSha256: published.rawSha256,
      record,
    });
    assertStoredBinding(stored);
    return stored;
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("STORE_IO_REJECTED");
  }
}

export async function readPrivateScreenEvidenceCaptureRevisionV1(
  input: ReadPrivateScreenEvidenceCaptureRevisionV1Input,
): Promise<StoredPrivateScreenEvidenceCaptureRevisionV1> {
  try {
    const result = readInputSchema.safeParse(boundarySnapshot(input));
    if (!result.success) return fail("STORE_INPUT_INVALID");
    return await readStoredRevision(
      result.data.projectDirectory,
      result.data.captureId,
      result.data.revision,
    );
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("STORE_IO_REJECTED");
  }
}

export async function readPrivateScreenEvidenceStoreSnapshotV1(
  input: ReadPrivateScreenEvidenceStoreSnapshotV1Input,
): Promise<PrivateScreenEvidenceStoreSnapshotV1> {
  try {
    const result = snapshotInputSchema.safeParse(boundarySnapshot(input));
    if (!result.success) return fail("STORE_INPUT_INVALID");
    const captureIds = new Set<string>();
    const refIdentities = new Set<string>();
    for (const ref of result.data.recordRefs) {
      const identity = `${ref.captureId}\0${ref.revision}`;
      if (captureIds.has(ref.captureId) || refIdentities.has(identity)) {
        return fail("SNAPSHOT_INVALID");
      }
      captureIds.add(ref.captureId);
      refIdentities.add(identity);
    }
    const records: StoredPrivateScreenEvidenceCaptureRevisionV1[] = [];
    let cumulativeSnapshotBytes = 0;
    for (const ref of result.data.recordRefs) {
      const stored = await readStoredRevision(
        result.data.projectDirectory,
        ref.captureId,
        ref.revision,
      );
      cumulativeSnapshotBytes = accumulateStoreBudget(
        cumulativeSnapshotBytes,
        stored.byteLength,
        PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes,
      );
      records.push(stored);
    }
    records.sort(compareStoredRecords);
    const storeDirectory = await requirePrivateScreenEvidenceDirectoryChainV1(
      result.data.projectDirectory,
      "store",
    );
    const snapshot = deepFreezePrivateScreenEvidenceV1({
      schemaVersion: PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1,
      storeDirectory,
      snapshotIdentitySha256: domainSeparatedDescriptorHash(
        "blabase.private-screen-evidence-snapshot.v1",
        records,
      ),
      records,
    });
    const validation = privateScreenEvidenceStoreSnapshotSchemaV1.safeParse(snapshot);
    if (!validation.success) return fail("SNAPSHOT_INVALID");
    return snapshot;
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("STORE_IO_REJECTED");
  }
}

export function selectPrivateScreenEvidenceForExportV1(
  input: SelectPrivateScreenEvidenceForExportV1Input,
): PrivateScreenEvidenceExportSelectionV1 {
  try {
    const result = selectionInputSchema.safeParse(boundarySnapshot(input));
    if (!result.success) return fail("STORE_INPUT_INVALID");
    if (result.data.window.endEpochMs < result.data.window.startEpochMs) {
      return fail("SELECTION_INVALID");
    }
    const snapshotRecords = result.data.snapshot
      .records as StoredPrivateScreenEvidenceCaptureRevisionV1[];
    let cumulativeSnapshotBytes = 0;
    for (const stored of snapshotRecords) {
      cumulativeSnapshotBytes = accumulateStoreBudget(
        cumulativeSnapshotBytes,
        stored.byteLength,
        PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes,
      );
    }
    const sortedSnapshotRecords = [...snapshotRecords].sort(compareStoredRecords);
    const expectedSnapshotIdentity = domainSeparatedDescriptorHash(
      "blabase.private-screen-evidence-snapshot.v1",
      sortedSnapshotRecords,
    );
    if (
      expectedSnapshotIdentity !== result.data.snapshot.snapshotIdentitySha256
    ) {
      return fail("SNAPSHOT_INVALID");
    }
    const captureIds = new Set<string>();
    for (const stored of sortedSnapshotRecords) {
      assertStoredBinding(stored);
      if (captureIds.has(stored.record.capture.captureId)) {
        return fail("SNAPSHOT_INVALID");
      }
      captureIds.add(stored.record.capture.captureId);
    }
    const records = sortedSnapshotRecords.filter((stored) => {
      const capturedAt = stored.record.capture.capturedAtEpochMs;
      const retentionSelectable =
        stored.record.retentionPolicy.disposition === "retain_under_hold" ||
        result.data.asOfEpochMs <
          stored.record.retentionPolicy.retainUntilEpochMs;
      return (
        stored.record.exportEligibility.status === "eligible" &&
        capturedAt >= result.data.window.startEpochMs &&
        capturedAt <= result.data.window.endEpochMs &&
        retentionSelectable
      );
    });
    if (
      records.some(
        (stored) =>
          stored.record.capture.capturedAtEpochMs > result.data.asOfEpochMs,
      )
    ) {
      return fail("SELECTION_INVALID");
    }
    if (records.length === 0) {
      if (result.data.privacyReviewReceipts.length > 0) {
        return fail("SELECTION_INVALID");
      }
      return fail("NO_ELIGIBLE_RECORDS");
    }
    if (result.data.privacyReviewReceipts.length !== records.length) {
      return fail("SELECTION_INVALID");
    }
    const receiptByCaptureId = new Map<
      string,
      PrivateScreenEvidencePrivacyReviewReceiptV1
    >();
    const reviewIds = new Set<string>();
    for (const receipt of result.data.privacyReviewReceipts) {
      if (
        receiptByCaptureId.has(receipt.captureId) ||
        reviewIds.has(receipt.reviewId) ||
        receipt.reviewedAtEpochMs > result.data.asOfEpochMs
      ) {
        return fail("SELECTION_INVALID");
      }
      receiptByCaptureId.set(receipt.captureId, receipt);
      reviewIds.add(receipt.reviewId);
    }
    const privacyReviewReceipts: PrivateScreenEvidencePrivacyReviewReceiptV1[] = [];
    for (const stored of records) {
      const receipt = receiptByCaptureId.get(stored.record.capture.captureId);
      if (
        receipt === undefined ||
        receipt.revision !== stored.record.capture.revision ||
        receipt.storedRawSha256 !== stored.rawSha256 ||
        receipt.privacyProfile !== stored.record.provenance.privacyProfile ||
        receipt.decision !== "approved" ||
        receipt.reviewedAtEpochMs < stored.record.capture.capturedAtEpochMs
      ) {
        return fail("SELECTION_INVALID");
      }
      privacyReviewReceipts.push(receipt);
    }
    const selection = deepFreezePrivateScreenEvidenceV1({
      schemaVersion: PRIVATE_SCREEN_EVIDENCE_SELECTION_SCHEMA_V1,
      sourceSnapshotIdentitySha256:
        result.data.snapshot.snapshotIdentitySha256,
      asOfEpochMs: result.data.asOfEpochMs,
      window: {
        startEpochMs: result.data.window.startEpochMs,
        endEpochMs: result.data.window.endEpochMs,
      },
      records,
      privacyReviewReceipts,
    });
    const validation = privateScreenEvidenceExportSelectionSchemaV1.safeParse(
      selection,
    );
    if (!validation.success) return fail("SELECTION_INVALID");
    return selection;
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("SELECTION_INVALID");
  }
}

function cleanupRecord(
  stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
): PrivateScreenEvidenceCleanupRecordV1 {
  return deepFreezePrivateScreenEvidenceV1({
    captureId: stored.record.capture.captureId,
    revision: stored.record.capture.revision,
    capturedAtEpochMs: stored.record.capture.capturedAtEpochMs,
    relativePath: stored.relativePath,
    byteLength: stored.byteLength,
    rawSha256: stored.rawSha256,
    exportEligibility: stored.record.exportEligibility,
    retentionPolicy: stored.record.retentionPolicy,
  });
}

interface PrivateScreenEvidenceInventoryBudgetV1 {
  used: number;
}

function consumePrivateScreenEvidenceInventoryBudgetV1(
  budget: PrivateScreenEvidenceInventoryBudgetV1,
): void {
  budget.used = accumulateStoreBudget(
    budget.used,
    1,
    PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.inventoryEntries,
  );
}

function emitPrivateScreenEvidenceInventoryEntryV1<T>(
  target: T[],
  entry: T,
  budget: PrivateScreenEvidenceInventoryBudgetV1,
): void {
  consumePrivateScreenEvidenceInventoryBudgetV1(budget);
  target.push(entry);
}

function privateScreenEvidenceInventoryListLimitV1(
  budget: PrivateScreenEvidenceInventoryBudgetV1,
): number {
  return Math.min(
    PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.directoryEntries,
    PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.inventoryEntries - budget.used,
  );
}

function rethrowPrivateScreenEvidenceInventoryBlockerV1(error: unknown): void {
  if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
  if (
    error instanceof PrivateScreenEvidenceFilesystemErrorV1 &&
    error.issueCode === "RESOURCE_LIMIT_EXCEEDED"
  ) {
    throw error;
  }
}

export async function inventoryPrivateScreenEvidenceStoreForCleanupV1(
  input: InventoryPrivateScreenEvidenceStoreForCleanupV1Input,
): Promise<PrivateScreenEvidenceCleanupInventoryV1> {
  try {
    const result = projectInputSchema.safeParse(boundarySnapshot(input));
    if (!result.success) return fail("STORE_INPUT_INVALID");
    const storeDirectory = await requirePrivateScreenEvidenceDirectoryChainV1(
      result.data.projectDirectory,
      "store",
    );
    const capturesDirectory = path.join(storeDirectory, "captures");
    await requirePrivateScreenEvidenceDirectoryV1(capturesDirectory);
    const inventoryBudget: PrivateScreenEvidenceInventoryBudgetV1 = {
      used: 0,
    };
    const captureNames = await listPrivateScreenEvidenceDirectoryNamesV1(
      capturesDirectory,
      privateScreenEvidenceInventoryListLimitV1(inventoryBudget),
    );
    const records: PrivateScreenEvidenceCleanupRecordV1[] = [];
    const orphans: PrivateScreenEvidenceCleanupInventoryV1["orphans"][number][] = [];
    const unsafeEntries: PrivateScreenEvidenceCleanupInventoryV1["unsafeEntries"][number][] = [];

    for (const captureName of captureNames) {
      consumePrivateScreenEvidenceInventoryBudgetV1(inventoryBudget);
      const captureRelative = `captures/${captureName}`;
      if (!sha256Pattern.test(captureName)) {
        emitPrivateScreenEvidenceInventoryEntryV1(
          unsafeEntries,
          {
            relativePath: captureRelative,
            classification: "unexpected-store-entry",
          },
          inventoryBudget,
        );
        continue;
      }
      const captureDirectory = path.join(capturesDirectory, captureName);
      try {
        await requirePrivateScreenEvidenceDirectoryV1(captureDirectory);
      } catch (error) {
        rethrowPrivateScreenEvidenceInventoryBlockerV1(error);
        emitPrivateScreenEvidenceInventoryEntryV1(
          unsafeEntries,
          {
            relativePath: captureRelative,
            classification: "unsafe-capture-directory",
          },
          inventoryBudget,
        );
        continue;
      }
      let captureEntries: readonly string[];
      try {
        captureEntries = await listPrivateScreenEvidenceDirectoryNamesV1(
          captureDirectory,
          privateScreenEvidenceInventoryListLimitV1(inventoryBudget),
        );
      } catch (error) {
        rethrowPrivateScreenEvidenceInventoryBlockerV1(error);
        emitPrivateScreenEvidenceInventoryEntryV1(
          unsafeEntries,
          {
            relativePath: captureRelative,
            classification: "unsafe-capture-directory",
          },
          inventoryBudget,
        );
        continue;
      }
      for (const entry of captureEntries) {
        consumePrivateScreenEvidenceInventoryBudgetV1(inventoryBudget);
        if (entry !== "revisions") {
          emitPrivateScreenEvidenceInventoryEntryV1(
            unsafeEntries,
            {
              relativePath: `${captureRelative}/${entry}`,
              classification: "unexpected-capture-entry",
            },
            inventoryBudget,
          );
        }
      }
      if (!captureEntries.includes("revisions")) {
        emitPrivateScreenEvidenceInventoryEntryV1(
          orphans,
          {
            relativePath: captureRelative,
            classification: "orphan-empty-capture-directory",
          },
          inventoryBudget,
        );
        continue;
      }
      const revisionsDirectory = path.join(captureDirectory, "revisions");
      try {
        await requirePrivateScreenEvidenceDirectoryV1(revisionsDirectory);
      } catch (error) {
        rethrowPrivateScreenEvidenceInventoryBlockerV1(error);
        emitPrivateScreenEvidenceInventoryEntryV1(
          unsafeEntries,
          {
            relativePath: `${captureRelative}/revisions`,
            classification: "unsafe-revisions-directory",
          },
          inventoryBudget,
        );
        continue;
      }
      let revisionNames: readonly string[];
      try {
        revisionNames = await listPrivateScreenEvidenceDirectoryNamesV1(
          revisionsDirectory,
          privateScreenEvidenceInventoryListLimitV1(inventoryBudget),
        );
      } catch (error) {
        rethrowPrivateScreenEvidenceInventoryBlockerV1(error);
        emitPrivateScreenEvidenceInventoryEntryV1(
          unsafeEntries,
          {
            relativePath: `${captureRelative}/revisions`,
            classification: "unsafe-revisions-directory",
          },
          inventoryBudget,
        );
        continue;
      }
      if (revisionNames.length === 0) {
        emitPrivateScreenEvidenceInventoryEntryV1(
          orphans,
          {
            relativePath: `${captureRelative}/revisions`,
            classification: "orphan-empty-revisions-directory",
          },
          inventoryBudget,
        );
      }
      for (const revisionName of revisionNames) {
        consumePrivateScreenEvidenceInventoryBudgetV1(inventoryBudget);
        const relativePath = `${captureRelative}/revisions/${revisionName}`;
        if (revisionName.startsWith(".tmp-")) {
          emitPrivateScreenEvidenceInventoryEntryV1(
            orphans,
            {
              relativePath,
              classification: "orphan-temporary-file",
            },
            inventoryBudget,
          );
          continue;
        }
        const match = /^([1-9][0-9]*)\.json$/u.exec(revisionName);
        if (match === null) {
          emitPrivateScreenEvidenceInventoryEntryV1(
            unsafeEntries,
            {
              relativePath,
              classification: "unexpected-revision-entry",
            },
            inventoryBudget,
          );
          continue;
        }
        const revision = Number(match[1]);
        if (!Number.isSafeInteger(revision)) {
          emitPrivateScreenEvidenceInventoryEntryV1(
            unsafeEntries,
            {
              relativePath,
              classification: "unexpected-revision-entry",
            },
            inventoryBudget,
          );
          continue;
        }
        try {
          const file = await readStablePrivateScreenEvidenceFileV1(
            path.join(revisionsDirectory, revisionName),
            PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes,
          );
          const record = parseRecordBytes(file.bytes);
          const stored = deepFreezePrivateScreenEvidenceV1({
            storageSchemaVersion:
              "blabase.private-screen-evidence-stored-revision.v1" as const,
            relativePath,
            byteLength: file.byteLength,
            rawSha256: file.rawSha256,
            record,
          });
          if (
            record.capture.revision !== revision ||
            captureDirectoryHash(record.capture.captureId) !== captureName
          ) {
            emitPrivateScreenEvidenceInventoryEntryV1(
              unsafeEntries,
              {
                relativePath,
                classification: "record-binding-invalid",
              },
              inventoryBudget,
            );
            continue;
          }
          assertStoredBinding(stored);
          if (records.length >= PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.records) {
            return fail("RESOURCE_LIMIT_EXCEEDED");
          }
          emitPrivateScreenEvidenceInventoryEntryV1(
            records,
            cleanupRecord(stored),
            inventoryBudget,
          );
        } catch (error) {
          rethrowPrivateScreenEvidenceInventoryBlockerV1(error);
          emitPrivateScreenEvidenceInventoryEntryV1(
            unsafeEntries,
            {
              relativePath,
              classification: "unsafe-revision-file",
            },
            inventoryBudget,
          );
        }
      }
    }

    records.sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
    orphans.sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
    unsafeEntries.sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
    return deepFreezePrivateScreenEvidenceV1({
      schemaVersion: PRIVATE_SCREEN_EVIDENCE_CLEANUP_INVENTORY_SCHEMA_V1,
      storeDirectory,
      records,
      orphans,
      unsafeEntries,
    });
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceStoreErrorV1) throw error;
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("STORE_IO_REJECTED");
  }
}

void PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1;
