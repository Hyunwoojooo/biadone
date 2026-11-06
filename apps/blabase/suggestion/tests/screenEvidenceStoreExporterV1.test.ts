import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCREEN_EVIDENCE_BUNDLE_FILES_V1,
  SCREEN_EVIDENCE_LIMITS_V1,
  SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
  SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
  type ScreenEvidenceBundleInputV1,
} from "../src/screenEvidence/contractsV1";
import {
  buildScreenEvidenceBundleV1,
  publishScreenEvidenceBundleV1,
  ScreenEvidenceExportErrorV1,
} from "../src/screenEvidence/exportScreenEvidenceBundleV1";
import {
  importScreenEvidenceBundleV1,
  ScreenEvidenceImportErrorV1,
} from "../src/screenEvidence/importScreenEvidenceBundleV1";
import {
  PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1,
  PRIVATE_SCREEN_EVIDENCE_EXPORTS_RELATIVE_DIRECTORY_V1,
  PRIVATE_SCREEN_EVIDENCE_LIMITS_V1,
  PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1,
  PRIVATE_SCREEN_EVIDENCE_PRIVACY_REVIEW_RECEIPT_SCHEMA_V1,
  PRIVATE_SCREEN_EVIDENCE_RETENTION_POLICY_V1,
  PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1,
  PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1,
  PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1,
  type PrivateScreenEvidenceCaptureRevisionV1,
  type PrivateScreenEvidenceExportEligibilityV1,
  type PrivateScreenEvidenceExportSelectionV1,
  type PrivateScreenEvidencePrivacyReviewReceiptV1,
  type PrivateScreenEvidenceStoreSnapshotV1,
  type StoredPrivateScreenEvidenceCaptureRevisionV1,
} from "../src/screenEvidence/privateStoreContractsV1";
import {
  canonicalPrivateScreenEvidenceJsonBytesV1,
} from "../src/screenEvidence/privateScreenEvidenceFilesystemV1.internal";
import {
  accumulatePrivateScreenEvidenceBudgetV1,
  PrivateScreenEvidenceBudgetErrorV1,
} from "../src/screenEvidence/privateScreenEvidenceBudgetsV1.internal";
import {
  inventoryPrivateScreenEvidenceStoreForCleanupV1,
  readPrivateScreenEvidenceCaptureRevisionV1,
  readPrivateScreenEvidenceStoreSnapshotV1,
  selectPrivateScreenEvidenceForExportV1,
  PrivateScreenEvidenceStoreErrorV1,
  writePrivateScreenEvidenceCaptureRevisionV1,
} from "../src/screenEvidence/privateScreenEvidenceStoreV1";
import {
  readScreenEvidenceBundleV1,
  ScreenEvidenceReadErrorV1,
} from "../src/screenEvidence/readScreenEvidenceBundleV1";
import {
  publishScreenEvidenceBundleV1Internal,
  PrivateScreenEvidencePublicationFaultV1,
  type PrivateScreenEvidencePublicationEventKindV1,
  type PrivateScreenEvidencePublicationFaultClassificationV1,
} from "../src/screenEvidence/publishScreenEvidenceBundleV1.internal";

interface RecordFixtureOptions {
  readonly captureId: string;
  readonly revision?: number;
  readonly capturedAtEpochMs?: number;
  readonly previousRevision?: Readonly<{
    revision: number;
    rawSha256: string;
  }> | null;
  readonly eligible?: boolean;
  readonly ocrText?: string;
  readonly applicationLabel?: string;
  readonly retainUntilEpochMs?: number;
  readonly retentionDisposition?: "delete_after_retention" | "retain_under_hold";
}

interface MutableBundleEntry {
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}

interface MutableBundle {
  bundleDirectoryName: string;
  entries: MutableBundleEntry[];
}

interface ChildBarrierConfig {
  readonly readyPath: string;
  readonly startPath: string;
  readonly timeoutMs: number;
}

interface SerializedChildBundle {
  readonly bundleDirectoryName: string;
  readonly entries: readonly Readonly<{
    relativePath: string;
    entryKind: "regular-file";
    byteLength: number;
    bytesBase64: string;
  }>[];
}

type ChildDriverConfigWithoutResult =
  | Readonly<{
      operation: "store-write";
      projectDirectory: string;
      record: PrivateScreenEvidenceCaptureRevisionV1;
      barrier: ChildBarrierConfig;
    }>
  | Readonly<{
      operation: "store-read";
      projectDirectory: string;
      captureId: string;
      revision: number;
    }>
  | Readonly<{
      operation: "publish";
      projectDirectory: string;
      bundle: SerializedChildBundle;
      barrier: ChildBarrierConfig;
    }>
  | Readonly<{
      operation: "bundle-read";
      bundleDirectory: string;
    }>;

interface ChildDriverFulfilledResult {
  readonly status: "fulfilled";
  readonly value: unknown;
}

interface ChildDriverRejectedResult {
  readonly status: "rejected";
  readonly errorName: string;
  readonly issueCode?: string;
}

type ChildDriverResult =
  | ChildDriverFulfilledResult
  | ChildDriverRejectedResult;

interface ChildStoredValue {
  readonly rawSha256: string;
  readonly record: PrivateScreenEvidenceCaptureRevisionV1;
}

interface ChildPublishedValue {
  readonly bundleDirectory: string;
  readonly payloadSha256: string;
  readonly manifestSha256: string;
}

interface ChildBundleReadValue {
  readonly payloadSha256: string;
  readonly manifestSha256: string;
  readonly exportRunId: string;
  readonly evidence: unknown;
}

const encoder = new TextEncoder();
const temporaryRoots = new Set<string>();
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const suggestionDirectory = path.dirname(testDirectory);
const childDriverPath = path.join(
  testDirectory,
  "fixtures",
  "screenEvidenceStoreExporterChildV1.ts",
);
const viteNodePath = path.join(
  suggestionDirectory,
  "node_modules",
  "vite-node",
  "vite-node.mjs",
);

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

async function makePrivateProject(mode = 0o700): Promise<string> {
  const canonicalTemporaryDirectory = await realpath(tmpdir());
  const root = await mkdtemp(
    path.join(canonicalTemporaryDirectory, "blabase-screen-store-test-"),
  );
  temporaryRoots.add(root);
  await chmod(root, mode);
  return root;
}

async function createPrivateDirectoryChain(
  projectDirectory: string,
  relativeDirectory: string,
): Promise<string> {
  let current = projectDirectory;
  for (const component of relativeDirectory.split("/")) {
    current = path.join(current, component);
    await mkdir(current, { mode: 0o700 });
    await chmod(current, 0o700);
  }
  return current;
}

function fixtureRecord(
  options: RecordFixtureOptions,
): PrivateScreenEvidenceCaptureRevisionV1 {
  const revision = options.revision ?? 1;
  const capturedAtEpochMs = options.capturedAtEpochMs ?? 1_000;
  const observations = [
    {
      observationId: `${options.captureId}-application-${revision}`,
      captureId: options.captureId,
      capturedAtEpochMs,
      kind: "application" as const,
      label: options.applicationLabel ?? "Synthetic private application label",
      confidence: 0.8,
    },
    {
      observationId: `${options.captureId}-ocr-${revision}`,
      captureId: options.captureId,
      capturedAtEpochMs,
      kind: "ocr_span" as const,
      text: options.ocrText ?? "Synthetic private OCR text",
      confidence: 0.9,
    },
  ];
  const exportEligibility: PrivateScreenEvidenceExportEligibilityV1 =
    options.eligible === false
      ? {
          status: "ineligible",
          reasonCodes: ["PRIVACY_REVIEW_REQUIRED"],
        }
      : { status: "eligible", reasonCodes: [] };
  return {
    schemaVersion: PRIVATE_SCREEN_EVIDENCE_CAPTURE_REVISION_SCHEMA_V1,
    capture: {
      captureId: options.captureId,
      revision,
      capturedAtEpochMs,
    },
    provenance: {
      sourceSystem: PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1,
      sourceRevision: `synthetic-source-${revision}`,
      authorizationId: "synthetic-authorization",
      preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
      privacyProfile: PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1,
    },
    previousRevision: options.previousRevision ?? null,
    observations,
    coverage: {
      captureCount: 1,
      observationCount: observations.length,
      ocrSpanCount: 1,
      coveredCaptureCount: 1,
      coveredCaptureRatio: 1,
    },
    conflicts: [],
    issues: [],
    exportEligibility,
    retentionPolicy: {
      policyVersion: PRIVATE_SCREEN_EVIDENCE_RETENTION_POLICY_V1,
      retainUntilEpochMs:
        options.retainUntilEpochMs ?? capturedAtEpochMs + 100_000,
      disposition:
        options.retentionDisposition ?? "delete_after_retention",
    },
  };
}

function approvedPrivacyReceipt(
  stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
  overrides: Partial<PrivateScreenEvidencePrivacyReviewReceiptV1> = {},
): PrivateScreenEvidencePrivacyReviewReceiptV1 {
  return {
    schemaVersion: PRIVATE_SCREEN_EVIDENCE_PRIVACY_REVIEW_RECEIPT_SCHEMA_V1,
    captureId: stored.record.capture.captureId,
    revision: stored.record.capture.revision,
    storedRawSha256: stored.rawSha256,
    privacyProfile: PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1,
    decision: "approved",
    reviewId: `review-${stored.record.capture.captureId}-${stored.record.capture.revision}`,
    reviewedAtEpochMs: stored.record.capture.capturedAtEpochMs,
    ...overrides,
  };
}

function compactDeclaredByteSnapshot(
  declaredByteLength: number,
): PrivateScreenEvidenceStoreSnapshotV1 {
  const records: StoredPrivateScreenEvidenceCaptureRevisionV1[] = [];
  let remaining = declaredByteLength;
  let index = 0;
  while (remaining > 0) {
    const byteLength = Math.min(
      remaining,
      PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes,
    );
    const captureId = `budget-capture-${String(index).padStart(3, "0")}`;
    records.push({
      storageSchemaVersion:
        "blabase.private-screen-evidence-stored-revision.v1",
      relativePath: `captures/${sha256Text(captureId)}/revisions/1.json`,
      byteLength,
      rawSha256: "0".repeat(64),
      record: fixtureRecord({
        captureId,
        capturedAtEpochMs: 10_000 + index,
      }),
    });
    remaining -= byteLength;
    index += 1;
  }
  return {
    schemaVersion: PRIVATE_SCREEN_EVIDENCE_SNAPSHOT_SCHEMA_V1,
    storeDirectory: "/synthetic/private-screen-evidence-store",
    snapshotIdentitySha256: "f".repeat(64),
    records,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function recordPath(
  projectDirectory: string,
  stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
): string {
  return path.join(
    projectDirectory,
    PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1,
    stored.relativePath,
  );
}

function cloneBundle(bundle: ScreenEvidenceBundleInputV1): MutableBundle {
  return {
    bundleDirectoryName: bundle.bundleDirectoryName,
    entries: bundle.entries.map((entry) => ({
      relativePath: entry.relativePath,
      entryKind: entry.entryKind,
      byteLength: entry.byteLength,
      bytes: entry.bytes.slice(),
    })),
  };
}

function serializeChildBundle(
  bundle: ScreenEvidenceBundleInputV1,
): SerializedChildBundle {
  return {
    bundleDirectoryName: bundle.bundleDirectoryName,
    entries: bundle.entries.map((entry) => ({
      relativePath: entry.relativePath,
      entryKind: entry.entryKind,
      byteLength: entry.byteLength,
      bytesBase64: Buffer.from(entry.bytes).toString("base64"),
    })),
  };
}

function bundleEntry(
  bundle: ScreenEvidenceBundleInputV1,
  relativePath: string,
) {
  const entry = bundle.entries.find(
    (candidate) => candidate.relativePath === relativePath,
  );
  if (entry === undefined) throw new Error(`Missing fixture entry: ${relativePath}`);
  return entry;
}

function rebindStoredRecord(
  stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
  record: PrivateScreenEvidenceCaptureRevisionV1,
): StoredPrivateScreenEvidenceCaptureRevisionV1 {
  const bytes = canonicalPrivateScreenEvidenceJsonBytesV1(record);
  return {
    ...stored,
    byteLength: bytes.byteLength,
    rawSha256: sha256(bytes),
    record,
  };
}

function expectedSourceRevision(
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
    new DataView(length.buffer).setBigUint64(
      0,
      BigInt(descriptor.byteLength),
      false,
    );
    hash.update(length);
    hash.update(descriptor);
  }
  return hash.digest("hex");
}

function expectDeeplyFrozen(value: unknown, visited = new Set<object>()): void {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    visited.has(value)
  ) {
    return;
  }
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, visited);
}

async function captureError(
  operation: () => unknown | Promise<unknown>,
): Promise<unknown> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value), { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function waitForPaths(
  paths: readonly string[],
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await Promise.all(paths.map((candidate) => access(candidate)));
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for child paths: ${paths.join(",")}`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function runChildDriver(
  coordinationDirectory: string,
  name: string,
  config: ChildDriverConfigWithoutResult,
): Promise<ChildDriverResult> {
  const configPath = path.join(coordinationDirectory, `${name}.config.json`);
  const resultPath = path.join(coordinationDirectory, `${name}.result.json`);
  await writePrivateJson(configPath, { ...config, resultPath });

  const child = spawn(
    process.execPath,
    [viteNodePath, childDriverPath, configPath],
    {
      cwd: suggestionDirectory,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Child ${name} terminated by ${signal}`));
        return;
      }
      resolve(code ?? -1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(
      `Child ${name} exited ${exitCode}; stdout=${stdout}; stderr=${stderr}`,
    );
  }
  return JSON.parse(await readFile(resultPath, "utf8")) as ChildDriverResult;
}

function fulfilledChildValues(
  results: readonly ChildDriverResult[],
): readonly ChildDriverFulfilledResult[] {
  return results.filter(
    (result): result is ChildDriverFulfilledResult =>
      result.status === "fulfilled",
  );
}

function rejectedChildValues(
  results: readonly ChildDriverResult[],
): readonly ChildDriverRejectedResult[] {
  return results.filter(
    (result): result is ChildDriverRejectedResult => result.status === "rejected",
  );
}

function expectBudgetIssue(
  operation: () => unknown,
  issueCode: string,
): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PrivateScreenEvidenceBudgetErrorV1);
  expect((caught as PrivateScreenEvidenceBudgetErrorV1).issueCode).toBe(
    issueCode,
  );
}

async function expectStoreIssue(
  operation: () => unknown | Promise<unknown>,
  issueCode: string,
): Promise<void> {
  const error = await captureError(operation);
  expect(error).toBeInstanceOf(PrivateScreenEvidenceStoreErrorV1);
  expect((error as PrivateScreenEvidenceStoreErrorV1).issueCode).toBe(issueCode);
}

async function expectExportIssue(
  operation: () => unknown | Promise<unknown>,
  issueCode: string,
): Promise<void> {
  const error = await captureError(operation);
  expect(error).toBeInstanceOf(ScreenEvidenceExportErrorV1);
  expect((error as ScreenEvidenceExportErrorV1).issueCode).toBe(issueCode);
}

describe("private Screen Evidence store V1", () => {
  it("writes and reads an owned canonical frozen revision with private modes", async () => {
    const projectDirectory = await makePrivateProject();
    const sourceRecord = fixtureRecord({ captureId: "capture-owned" });
    const expectedBytes = canonicalPrivateScreenEvidenceJsonBytesV1(sourceRecord);

    const written = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: sourceRecord,
    });
    const absoluteRecordPath = recordPath(projectDirectory, written);
    const read = await readPrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      captureId: "capture-owned",
      revision: 1,
    });

    expect(new Uint8Array(await readFile(absoluteRecordPath))).toEqual(
      expectedBytes,
    );
    expect(written.rawSha256).toBe(sha256(expectedBytes));
    expect(read).toEqual(written);
    expect(read.record).not.toBe(sourceRecord);
    expectDeeplyFrozen(written);
    expectDeeplyFrozen(read);

    const privateDirectories = [
      ".local",
      ".local/screen-evidence",
      ".local/screen-evidence/v1",
      PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1,
      path.dirname(path.dirname(written.relativePath)),
      path.dirname(written.relativePath),
    ];
    for (const relativeDirectory of privateDirectories) {
      const absoluteDirectory = relativeDirectory.startsWith("captures/")
        ? path.join(
            projectDirectory,
            PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1,
            relativeDirectory,
          )
        : path.join(projectDirectory, relativeDirectory);
      expect((await stat(absoluteDirectory)).mode & 0o777).toBe(0o700);
    }
    expect((await stat(absoluteRecordPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects revision zero, unsafe identifiers, hostile input, forbidden fields and oversized text", async () => {
    const projectDirectory = await makePrivateProject();
    const revisionZero = {
      ...fixtureRecord({ captureId: "capture-zero" }),
      capture: {
        ...fixtureRecord({ captureId: "capture-zero" }).capture,
        revision: 0,
      },
    } as unknown as PrivateScreenEvidenceCaptureRevisionV1;
    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: revisionZero,
        }),
      "STORE_INPUT_INVALID",
    );

    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: fixtureRecord({ captureId: "../unsafe" }),
        }),
      "STORE_INPUT_INVALID",
    );

    const hostileInput = new Proxy(
      {
        projectDirectory,
        record: fixtureRecord({ captureId: "capture-proxy" }),
      },
      {},
    );
    await expectStoreIssue(
      () => writePrivateScreenEvidenceCaptureRevisionV1(hostileInput),
      "STORE_INPUT_INVALID",
    );

    const forbiddenRecord = {
      ...fixtureRecord({ captureId: "capture-forbidden" }),
      semanticOutput: { title: "Synthetic forbidden output" },
    } as unknown as PrivateScreenEvidenceCaptureRevisionV1;
    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: forbiddenRecord,
        }),
      "STORE_INPUT_INVALID",
    );

    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: fixtureRecord({
            captureId: "capture-oversized",
            ocrText: "x".repeat(
              PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes + 1,
            ),
          }),
        }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("accepts an ordinary owned project root but rejects group-writable roots", async () => {
    if (process.platform === "win32") return;

    const ordinaryProject = await makePrivateProject(0o755);
    const stored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: ordinaryProject,
      record: fixtureRecord({ captureId: "capture-ordinary-root" }),
    });
    expect(
      await readPrivateScreenEvidenceCaptureRevisionV1({
        projectDirectory: ordinaryProject,
        captureId: "capture-ordinary-root",
        revision: 1,
      }),
    ).toEqual(stored);

    const unsafeProject = await makePrivateProject(0o775);
    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory: unsafeProject,
          record: fixtureRecord({ captureId: "capture-writable-root" }),
        }),
      "STORE_UNSAFE",
    );
    await expect(
      access(path.join(unsafeProject, ".local")),
    ).rejects.toBeDefined();
  });

  it("enforces the exact previous revision hash and never overwrites a revision", async () => {
    const projectDirectory = await makePrivateProject();
    const first = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-chain" }),
    });
    const secondRecord = fixtureRecord({
      captureId: "capture-chain",
      revision: 2,
      capturedAtEpochMs: 1_100,
      previousRevision: { revision: 1, rawSha256: first.rawSha256 },
    });
    const second = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: secondRecord,
    });
    expect(second.record.previousRevision).toEqual({
      revision: 1,
      rawSha256: first.rawSha256,
    });

    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: fixtureRecord({
            captureId: "capture-missing-previous",
            revision: 2,
            previousRevision: { revision: 1, rawSha256: "0".repeat(64) },
          }),
        }),
      "REVISION_CHAIN_INVALID",
    );
    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: fixtureRecord({
            captureId: "capture-chain",
            revision: 3,
            previousRevision: { revision: 2, rawSha256: "0".repeat(64) },
          }),
        }),
      "REVISION_CHAIN_INVALID",
    );

    const firstPath = recordPath(projectDirectory, first);
    const firstBytes = await readFile(firstPath);
    await expectStoreIssue(
      () =>
        writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: fixtureRecord({ captureId: "capture-chain" }),
        }),
      "REVISION_EXISTS",
    );
    expect(await readFile(firstPath)).toEqual(firstBytes);
    expect(
      (
        await readPrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          captureId: "capture-chain",
          revision: 1,
        })
      ).rawSha256,
    ).toBe(first.rawSha256);
  });

  it("allows exactly one concurrent writer for the same revision without clobber", async () => {
    const projectDirectory = await makePrivateProject();
    const record = fixtureRecord({ captureId: "capture-race" });
    const outcomes = await Promise.allSettled([
      writePrivateScreenEvidenceCaptureRevisionV1({ projectDirectory, record }),
      writePrivateScreenEvidenceCaptureRevisionV1({ projectDirectory, record }),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PrivateScreenEvidenceStoreErrorV1,
    );
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as PrivateScreenEvidenceStoreErrorV1)
        .issueCode,
    ).toBe("REVISION_EXISTS");

    const winner = (fulfilled[0] as PromiseFulfilledResult<StoredPrivateScreenEvidenceCaptureRevisionV1>)
      .value;
    const read = await readPrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      captureId: "capture-race",
      revision: 1,
    });
    expect(read.rawSha256).toBe(winner.rawSha256);
    expect(
      new Uint8Array(await readFile(recordPath(projectDirectory, read))),
    ).toEqual(canonicalPrivateScreenEvidenceJsonBytesV1(record));
  });

  it("reads only exact snapshot refs and rejects duplicates, missing refs and multiple revisions per capture", async () => {
    const projectDirectory = await makePrivateProject();
    const firstA = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-a", capturedAtEpochMs: 2_000 }),
    });
    const firstB = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-b", capturedAtEpochMs: 1_000 }),
    });
    const secondA = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({
        captureId: "capture-a",
        revision: 2,
        capturedAtEpochMs: 2_100,
        previousRevision: { revision: 1, rawSha256: firstA.rawSha256 },
      }),
    });

    const snapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
      projectDirectory,
      recordRefs: [
        { captureId: "capture-a", revision: 2 },
        { captureId: "capture-b", revision: 1 },
      ],
    });
    expect(snapshot.records.map((stored) => stored.rawSha256)).toEqual([
      firstB.rawSha256,
      secondA.rawSha256,
    ]);
    expect(snapshot.records.map((stored) => stored.record.capture.revision)).toEqual([
      1,
      2,
    ]);
    expectDeeplyFrozen(snapshot);

    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceStoreSnapshotV1({
          projectDirectory,
          recordRefs: [
            { captureId: "capture-b", revision: 1 },
            { captureId: "capture-b", revision: 1 },
          ],
        }),
      "SNAPSHOT_INVALID",
    );
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceStoreSnapshotV1({
          projectDirectory,
          recordRefs: [{ captureId: "capture-missing", revision: 1 }],
        }),
      "RECORD_NOT_FOUND",
    );
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceStoreSnapshotV1({
          projectDirectory,
          recordRefs: [
            { captureId: "capture-a", revision: 1 },
            { captureId: "capture-a", revision: 2 },
          ],
        }),
      "SNAPSHOT_INVALID",
    );
  });

  it("inventories eligible, ineligible and orphan metadata without leaking text or deleting entries", async () => {
    const projectDirectory = await makePrivateProject();
    const eligible = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-inventory-eligible" }),
    });
    await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({
        captureId: "capture-inventory-ineligible",
        capturedAtEpochMs: 2_000,
        eligible: false,
      }),
    });

    const storeDirectory = path.join(
      projectDirectory,
      PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1,
    );
    const capturesDirectory = path.join(storeDirectory, "captures");
    const temporaryFile = path.join(
      path.dirname(recordPath(projectDirectory, eligible)),
      ".tmp-interrupted-write",
    );
    await writeFile(temporaryFile, encoder.encode("synthetic partial"), {
      mode: 0o600,
    });
    await chmod(temporaryFile, 0o600);

    const emptyCaptureDirectory = path.join(
      capturesDirectory,
      sha256Text("empty-capture"),
    );
    await mkdir(emptyCaptureDirectory, { mode: 0o700 });
    await chmod(emptyCaptureDirectory, 0o700);
    const emptyRevisionCaptureDirectory = path.join(
      capturesDirectory,
      sha256Text("empty-revisions"),
    );
    const emptyRevisionsDirectory = path.join(
      emptyRevisionCaptureDirectory,
      "revisions",
    );
    await mkdir(emptyRevisionCaptureDirectory, { mode: 0o700 });
    await chmod(emptyRevisionCaptureDirectory, 0o700);
    await mkdir(emptyRevisionsDirectory, { mode: 0o700 });
    await chmod(emptyRevisionsDirectory, 0o700);

    const inventory = await inventoryPrivateScreenEvidenceStoreForCleanupV1({
      projectDirectory,
    });
    expect(inventory.records).toHaveLength(2);
    expect(
      inventory.records.map((record) => record.exportEligibility.status).sort(),
    ).toEqual(["eligible", "ineligible"]);
    expect(inventory.orphans.map((orphan) => orphan.classification).sort()).toEqual([
      "orphan-empty-capture-directory",
      "orphan-empty-revisions-directory",
      "orphan-temporary-file",
    ]);
    expect(inventory.unsafeEntries).toEqual([]);
    const serializedInventory = JSON.stringify(inventory);
    expect(serializedInventory).not.toContain("Synthetic private OCR text");
    expect(serializedInventory).not.toContain(
      "Synthetic private application label",
    );
    expectDeeplyFrozen(inventory);

    await expect(access(temporaryFile)).resolves.toBeUndefined();
    await expect(access(emptyCaptureDirectory)).resolves.toBeUndefined();
    await expect(access(emptyRevisionsDirectory)).resolves.toBeUndefined();
  });

  it("rejects symlink, hardlink, unsafe permissions, oversized and truncated stored files", async () => {
    if (process.platform === "win32") return;

    const symlinkProject = await makePrivateProject();
    const symlinkStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: symlinkProject,
      record: fixtureRecord({ captureId: "capture-symlink" }),
    });
    const symlinkRecordPath = recordPath(symlinkProject, symlinkStored);
    const symlinkTarget = path.join(symlinkProject, "synthetic-target.json");
    await writeFile(symlinkTarget, await readFile(symlinkRecordPath), { mode: 0o600 });
    await chmod(symlinkTarget, 0o600);
    await unlink(symlinkRecordPath);
    await symlink(symlinkTarget, symlinkRecordPath);
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory: symlinkProject,
          captureId: "capture-symlink",
          revision: 1,
        }),
      "STORE_UNSAFE",
    );

    const hardlinkProject = await makePrivateProject();
    const hardlinkStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: hardlinkProject,
      record: fixtureRecord({ captureId: "capture-hardlink" }),
    });
    await link(
      recordPath(hardlinkProject, hardlinkStored),
      path.join(hardlinkProject, "synthetic-hardlink.json"),
    );
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory: hardlinkProject,
          captureId: "capture-hardlink",
          revision: 1,
        }),
      "STORE_UNSAFE",
    );

    const permissionProject = await makePrivateProject();
    const permissionStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: permissionProject,
      record: fixtureRecord({ captureId: "capture-permission" }),
    });
    await chmod(recordPath(permissionProject, permissionStored), 0o640);
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory: permissionProject,
          captureId: "capture-permission",
          revision: 1,
        }),
      "STORE_UNSAFE",
    );

    const oversizedProject = await makePrivateProject();
    const oversizedStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: oversizedProject,
      record: fixtureRecord({ captureId: "capture-file-oversized" }),
    });
    const oversizedPath = recordPath(oversizedProject, oversizedStored);
    await writeFile(
      oversizedPath,
      new Uint8Array(PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes + 1),
    );
    await chmod(oversizedPath, 0o600);
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory: oversizedProject,
          captureId: "capture-file-oversized",
          revision: 1,
        }),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const truncatedProject = await makePrivateProject();
    const truncatedStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: truncatedProject,
      record: fixtureRecord({ captureId: "capture-file-truncated" }),
    });
    const truncatedPath = recordPath(truncatedProject, truncatedStored);
    const originalBytes = await readFile(truncatedPath);
    await writeFile(truncatedPath, originalBytes.subarray(0, originalBytes.length - 1));
    await chmod(truncatedPath, 0o600);
    await expectStoreIssue(
      () =>
        readPrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory: truncatedProject,
          captureId: "capture-file-truncated",
          revision: 1,
        }),
      "RECORD_INVALID",
    );
  });
});

async function buildSelectionFixture(): Promise<Readonly<{
  projectDirectory: string;
  snapshot: PrivateScreenEvidenceStoreSnapshotV1;
  selection: PrivateScreenEvidenceExportSelectionV1;
  records: readonly StoredPrivateScreenEvidenceCaptureRevisionV1[];
}>> {
  const projectDirectory = await makePrivateProject();
  const records = await Promise.all([
    writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-window-end", capturedAtEpochMs: 2_000 }),
    }),
    writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-window-start", capturedAtEpochMs: 1_000 }),
    }),
    writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({
        captureId: "capture-window-ineligible",
        capturedAtEpochMs: 1_500,
        eligible: false,
      }),
    }),
    writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({ captureId: "capture-window-outside", capturedAtEpochMs: 2_001 }),
    }),
  ]);
  const snapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
    projectDirectory,
    recordRefs: records.map((stored) => ({
      captureId: stored.record.capture.captureId,
      revision: stored.record.capture.revision,
    })),
  });
  const asOfEpochMs = 2_500;
  const privacyReviewReceipts = snapshot.records
    .filter((stored) => {
      const capturedAtEpochMs = stored.record.capture.capturedAtEpochMs;
      return (
        stored.record.exportEligibility.status === "eligible" &&
        capturedAtEpochMs >= 1_000 &&
        capturedAtEpochMs <= 2_000 &&
        (stored.record.retentionPolicy.disposition === "retain_under_hold" ||
          asOfEpochMs < stored.record.retentionPolicy.retainUntilEpochMs)
      );
    })
    .map((stored) => approvedPrivacyReceipt(stored));
  const selection = selectPrivateScreenEvidenceForExportV1({
    snapshot,
    window: { startEpochMs: 1_000, endEpochMs: 2_000 },
    asOfEpochMs,
    privacyReviewReceipts,
  });
  return { projectDirectory, snapshot, selection, records };
}

describe("Screen Evidence export selection and bundle V1", () => {
  it("selects an inclusive canonical window independently from cleanup eligibility", async () => {
    const fixture = await buildSelectionFixture();
    expect(
      fixture.selection.records.map((stored) => stored.record.capture.captureId),
    ).toEqual(["capture-window-start", "capture-window-end"]);
    expect(fixture.selection.records.map((stored) => stored.record.capture.capturedAtEpochMs)).toEqual([
      1_000,
      2_000,
    ]);
    expect(fixture.selection.asOfEpochMs).toBe(2_500);
    expect(
      fixture.selection.privacyReviewReceipts.map((receipt) => receipt.captureId),
    ).toEqual(["capture-window-start", "capture-window-end"]);

    const inventory = await inventoryPrivateScreenEvidenceStoreForCleanupV1({
      projectDirectory: fixture.projectDirectory,
    });
    expect(
      inventory.records.find(
        (record) => record.captureId === "capture-window-ineligible",
      )?.exportEligibility.status,
    ).toBe("ineligible");

    const ineligible = fixture.records.find(
      (stored) =>
        stored.record.capture.captureId === "capture-window-ineligible",
    );
    if (ineligible === undefined) throw new Error("Missing ineligible fixture");
    const ineligibleSnapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
      projectDirectory: fixture.projectDirectory,
      recordRefs: [{ captureId: ineligible.record.capture.captureId, revision: 1 }],
    });
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot: ineligibleSnapshot,
          window: { startEpochMs: 1_000, endEpochMs: 2_000 },
          asOfEpochMs: 2_500,
          privacyReviewReceipts: [],
        }),
      "NO_ELIGIBLE_RECORDS",
    );
  });

  it("requires one exact hash-bound approved privacy receipt per selected record", async () => {
    const fixture = await buildSelectionFixture();
    const receipts = fixture.selection.privacyReviewReceipts;
    const first = receipts[0];
    const second = receipts[1];
    if (first === undefined || second === undefined) {
      throw new Error("Missing privacy receipt fixtures");
    }
    const select = (
      privacyReviewReceipts: readonly PrivateScreenEvidencePrivacyReviewReceiptV1[],
      asOfEpochMs = fixture.selection.asOfEpochMs,
    ) =>
      selectPrivateScreenEvidenceForExportV1({
        snapshot: fixture.snapshot,
        window: fixture.selection.window,
        asOfEpochMs,
        privacyReviewReceipts,
      });

    await expectStoreIssue(() => select([second]), "SELECTION_INVALID");
    await expectStoreIssue(
      () => select([first, second, first]),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        select([
          first,
          approvedPrivacyReceipt(fixture.selection.records[1]!, {
            reviewId: first.reviewId,
          }),
        ]),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        select([
          approvedPrivacyReceipt(fixture.selection.records[0]!, {
            storedRawSha256: "0".repeat(64),
          }),
          second,
        ]),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        select([
          approvedPrivacyReceipt(fixture.selection.records[0]!, {
            revision: first.revision + 1,
          }),
          second,
        ]),
      "SELECTION_INVALID",
    );
    const outside = fixture.records.find(
      (stored) => stored.record.capture.captureId === "capture-window-outside",
    );
    if (outside === undefined) throw new Error("Missing outside-window fixture");
    await expectStoreIssue(
      () => select([first, second, approvedPrivacyReceipt(outside)]),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        select([
          approvedPrivacyReceipt(fixture.selection.records[0]!, {
            reviewedAtEpochMs: fixture.selection.asOfEpochMs + 1,
          }),
          second,
        ]),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1(
          {
            snapshot: fixture.snapshot,
            window: fixture.selection.window,
            privacyReviewReceipts: receipts,
          } as unknown as Parameters<
            typeof selectPrivateScreenEvidenceForExportV1
          >[0],
        ),
      "STORE_INPUT_INVALID",
    );

    const mismatchedSelection = {
      ...fixture.selection,
      privacyReviewReceipts: [
        approvedPrivacyReceipt(fixture.selection.records[0]!, {
          storedRawSha256: "0".repeat(64),
        }),
        second,
      ],
    };
    await expectExportIssue(
      () =>
        buildScreenEvidenceBundleV1({
          exportRunId: "receipt-revalidation-run",
          selection: mismatchedSelection,
        }),
      "SELECTION_INVALID",
    );
  });

  it("applies delete retention before/equality/after and preserves retain-under-hold", async () => {
    const projectDirectory = await makePrivateProject();
    const deleteAfterRetention = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({
        captureId: "capture-delete-retention",
        capturedAtEpochMs: 1_000,
        retainUntilEpochMs: 2_000,
      }),
    });
    const retainedUnderHold = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({
        captureId: "capture-retention-hold",
        capturedAtEpochMs: 1_100,
        retainUntilEpochMs: 1_500,
        retentionDisposition: "retain_under_hold",
      }),
    });
    const snapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
      projectDirectory,
      recordRefs: [
        { captureId: "capture-retention-hold", revision: 1 },
        { captureId: "capture-delete-retention", revision: 1 },
      ],
    });
    const deleteReceipt = approvedPrivacyReceipt(deleteAfterRetention);
    const holdReceipt = approvedPrivacyReceipt(retainedUnderHold);

    const before = selectPrivateScreenEvidenceForExportV1({
      snapshot,
      window: { startEpochMs: 1_000, endEpochMs: 1_100 },
      asOfEpochMs: 1_999,
      privacyReviewReceipts: [deleteReceipt, holdReceipt],
    });
    expect(before.records.map((stored) => stored.record.capture.captureId)).toEqual([
      "capture-delete-retention",
      "capture-retention-hold",
    ]);

    const atEquality = selectPrivateScreenEvidenceForExportV1({
      snapshot,
      window: { startEpochMs: 1_000, endEpochMs: 1_100 },
      asOfEpochMs: 2_000,
      privacyReviewReceipts: [holdReceipt],
    });
    expect(
      atEquality.records.map((stored) => stored.record.capture.captureId),
    ).toEqual(["capture-retention-hold"]);

    const after = selectPrivateScreenEvidenceForExportV1({
      snapshot,
      window: { startEpochMs: 1_000, endEpochMs: 1_100 },
      asOfEpochMs: 2_001,
      privacyReviewReceipts: [holdReceipt],
    });
    expect(after.records.map((stored) => stored.record.capture.captureId)).toEqual([
      "capture-retention-hold",
    ]);
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot,
          window: { startEpochMs: 1_000, endEpochMs: 1_100 },
          asOfEpochMs: 2_000,
          privacyReviewReceipts: [deleteReceipt, holdReceipt],
        }),
      "SELECTION_INVALID",
    );
  });

  it("rejects duplicate observations, dangling refs, count drift and multiple selected revisions", async () => {
    const fixture = await buildSelectionFixture();
    const [first, second] = fixture.selection.records;
    if (first === undefined || second === undefined) {
      throw new Error("Missing selected fixtures");
    }

    const duplicatedObservationRecord = {
      ...second.record,
      observations: second.record.observations.map((observation, index) =>
        index === 0
          ? {
              ...observation,
              observationId: first.record.observations[0]!.observationId,
            }
          : observation,
      ),
    } as PrivateScreenEvidenceCaptureRevisionV1;
    const duplicateObservationStored = rebindStoredRecord(
      second,
      duplicatedObservationRecord,
    );
    const duplicateObservationSelection = {
      ...fixture.selection,
      records: [first, duplicateObservationStored],
      privacyReviewReceipts: [
        fixture.selection.privacyReviewReceipts[0]!,
        approvedPrivacyReceipt(duplicateObservationStored),
      ],
    };
    await expectExportIssue(
      () =>
        buildScreenEvidenceBundleV1({
          exportRunId: "duplicate-observation-run",
          selection: duplicateObservationSelection,
        }),
      "REFERENCE_INVALID",
    );

    const danglingIssueRecord = {
      ...first.record,
      issues: [
        ...first.record.issues,
        {
          code: "CAPTURE_GAP" as const,
          beforeCaptureId: first.record.capture.captureId,
          afterCaptureId: "capture-not-selected",
        },
      ],
    };
    const danglingIssueStored = rebindStoredRecord(first, danglingIssueRecord);
    await expectExportIssue(
      () =>
        buildScreenEvidenceBundleV1({
          exportRunId: "dangling-reference-run",
          selection: {
            ...fixture.selection,
            records: [danglingIssueStored, second],
            privacyReviewReceipts: [
              approvedPrivacyReceipt(danglingIssueStored),
              fixture.selection.privacyReviewReceipts[1]!,
            ],
          },
        }),
      "REFERENCE_INVALID",
    );

    const countDriftRecord = {
      ...first.record,
      coverage: {
        ...first.record.coverage,
        observationCount: first.record.coverage.observationCount + 1,
      },
    };
    const countDriftStored = rebindStoredRecord(first, countDriftRecord);
    await expectExportIssue(
      () =>
        buildScreenEvidenceBundleV1({
          exportRunId: "count-drift-run",
          selection: {
            ...fixture.selection,
            records: [countDriftStored, second],
            privacyReviewReceipts: [
              approvedPrivacyReceipt(countDriftStored),
              fixture.selection.privacyReviewReceipts[1]!,
            ],
          },
        }),
      "SELECTION_INVALID",
    );

    const revisionProject = await makePrivateProject();
    const revisionOne = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: revisionProject,
      record: fixtureRecord({ captureId: "capture-two-revisions" }),
    });
    const revisionTwo = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: revisionProject,
      record: fixtureRecord({
        captureId: "capture-two-revisions",
        revision: 2,
        capturedAtEpochMs: 1_100,
        previousRevision: { revision: 1, rawSha256: revisionOne.rawSha256 },
      }),
    });
    await expectExportIssue(
      () =>
        buildScreenEvidenceBundleV1({
          exportRunId: "multiple-revisions-run",
          selection: {
            ...fixture.selection,
            records: [revisionOne, revisionTwo],
            window: { startEpochMs: 1_000, endEpochMs: 1_100 },
            privacyReviewReceipts: [
              approvedPrivacyReceipt(revisionOne),
              approvedPrivacyReceipt(revisionTwo),
            ],
          },
        }),
      "SELECTION_INVALID",
    );
  });

  it("builds four canonical files with fixed identities, ordering, coverage and source revision", async () => {
    const { selection } = await buildSelectionFixture();
    const bundle = buildScreenEvidenceBundleV1({
      exportRunId: "canonical-export-run",
      selection,
    });
    expect(bundle.entries.map((entry) => entry.relativePath)).toEqual([
      "payload.json",
      "manifest.json",
      "manifest.sha256",
      "COMPLETE",
    ]);
    expect(bundle.entries.map((entry) => entry.relativePath)).toEqual(
      SCREEN_EVIDENCE_BUNDLE_FILES_V1,
    );
    for (const entry of bundle.entries) {
      expect(entry.entryKind).toBe("regular-file");
      expect(entry.byteLength).toBe(entry.bytes.byteLength);
    }

    const imported = importScreenEvidenceBundleV1(bundle);
    expect(imported.evidence).toMatchObject({
      producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
      preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
      provenance: {
        sourceSystem: PRIVATE_SCREEN_EVIDENCE_SOURCE_SYSTEM_V1,
        sourceRevision: expectedSourceRevision(selection.records),
        preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
        privacyProfile: PRIVATE_SCREEN_EVIDENCE_PRIVACY_PROFILE_V1,
      },
      coverage: {
        captureCount: 2,
        observationCount: 4,
        ocrSpanCount: 2,
        coveredCaptureCount: 2,
        coveredCaptureRatio: 1,
      },
    });
    expect(
      imported.evidence.captures.map((capture) => capture.captureId),
    ).toEqual(["capture-window-start", "capture-window-end"]);
    expect(
      imported.evidence.observations.map(
        (observation) => observation.observationId,
      ),
    ).toEqual([
      "capture-window-start-application-1",
      "capture-window-start-ocr-1",
      "capture-window-end-application-1",
      "capture-window-end-ocr-1",
    ]);
    expect(imported.manifest.producerIdentity).toBe(
      SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
    );
    expect(JSON.stringify(imported.evidence)).not.toContain("asOfEpochMs");
    for (const receipt of selection.privacyReviewReceipts) {
      expect(JSON.stringify(imported.evidence)).not.toContain(receipt.reviewId);
    }
    expect(imported.evidence.producerIdentity.toLowerCase()).not.toContain(
      "dayflow",
    );
    expectDeeplyFrozen(imported);
  });

  it("orders mixed-case conflict and issue identities by deterministic code units while preserving Unicode evidence", async () => {
    const projectDirectory = await makePrivateProject();
    const fixtures = [
      ["capture-A", 1_000, "Ångström"],
      ["capture-B", 1_100, "Ω evidence"],
      ["capture-a", 1_200, "가 evidence"],
      ["capture-b", 1_300, "é evidence"],
    ] as const;
    const storedRecords: StoredPrivateScreenEvidenceCaptureRevisionV1[] = [];
    for (const [captureId, capturedAtEpochMs, ocrText] of fixtures) {
      const base = fixtureRecord({ captureId, capturedAtEpochMs, ocrText });
      storedRecords.push(
        await writePrivateScreenEvidenceCaptureRevisionV1({
          projectDirectory,
          record: {
            ...base,
            conflicts: [
              { code: "CAPTURE_REVISION_CONFLICT", captureId },
            ],
            issues: [{ code: "CAPTURE_PARTIAL", captureId }],
          },
        }),
      );
    }
    const snapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
      projectDirectory,
      recordRefs: [...storedRecords]
        .reverse()
        .map((stored) => ({
          captureId: stored.record.capture.captureId,
          revision: stored.record.capture.revision,
        })),
    });
    const selection = selectPrivateScreenEvidenceForExportV1({
      snapshot,
      window: { startEpochMs: 1_000, endEpochMs: 1_300 },
      asOfEpochMs: 1_400,
      privacyReviewReceipts: snapshot.records.map((stored) =>
        approvedPrivacyReceipt(stored),
      ),
    });
    const imported = importScreenEvidenceBundleV1(
      buildScreenEvidenceBundleV1({
        exportRunId: "code-unit-order-run",
        selection,
      }),
    );

    expect(imported.evidence.conflicts.map((conflict) => conflict.captureId)).toEqual([
      "capture-A",
      "capture-B",
      "capture-a",
      "capture-b",
    ]);
    expect(
      imported.evidence.issues.map((issue) =>
        "captureId" in issue ? issue.captureId : "",
      ),
    ).toEqual(["capture-A", "capture-B", "capture-a", "capture-b"]);
    expect(
      imported.evidence.observations
        .filter((observation) => observation.kind === "ocr_span")
        .map((observation) => observation.text),
    ).toEqual(["Ångström", "Ω evidence", "가 evidence", "é evidence"]);
  });
});

describe("Screen Evidence bundle publication V1", () => {
  it("publishes exactly four private files and roundtrips through importer and reader", async () => {
    const { projectDirectory, selection } = await buildSelectionFixture();
    const bundle = buildScreenEvidenceBundleV1({
      exportRunId: "published-export-run",
      selection,
    });
    const preflight = importScreenEvidenceBundleV1(bundle);
    const publication = await publishScreenEvidenceBundleV1({
      projectDirectory,
      bundle,
    });

    expect(path.basename(publication.bundleDirectory)).toBe(
      "published-export-run",
    );
    expect((await stat(publication.bundleDirectory)).mode & 0o777).toBe(0o700);
    expect((await readdir(publication.bundleDirectory)).sort()).toEqual(
      ["COMPLETE", "manifest.json", "manifest.sha256", "payload.json"].sort(),
    );
    for (const fileName of SCREEN_EVIDENCE_BUNDLE_FILES_V1) {
      expect(
        (await stat(path.join(publication.bundleDirectory, fileName))).mode &
          0o777,
      ).toBe(0o600);
    }

    const manifestBytes = await readFile(
      path.join(publication.bundleDirectory, "manifest.json"),
    );
    const expectedMarker = encoder.encode(sha256(manifestBytes));
    expect(
      new Uint8Array(
        await readFile(
          path.join(publication.bundleDirectory, "manifest.sha256"),
        ),
      ),
    ).toEqual(expectedMarker);
    expect(
      new Uint8Array(
        await readFile(path.join(publication.bundleDirectory, "COMPLETE")),
      ),
    ).toEqual(expectedMarker);

    const readback = await readScreenEvidenceBundleV1({
      bundleDirectory: publication.bundleDirectory,
    });
    expect(readback.imported).toEqual(preflight);
    const {
      copySourceEntries: copyPublishedSourceEntries,
      ...publishedReadbackData
    } = publication.readback;
    const {
      copySourceEntries: copyRereadSourceEntries,
      ...rereadData
    } = readback;
    expect(publishedReadbackData).toEqual(rereadData);
    expect(await copyPublishedSourceEntries()).toEqual(
      await copyRereadSourceEntries(),
    );
    expectDeeplyFrozen(publication);
  });

  it("allows one publisher per exportRunId and leaves the winner unchanged", async () => {
    const { projectDirectory, selection } = await buildSelectionFixture();
    const bundle = buildScreenEvidenceBundleV1({
      exportRunId: "concurrent-export-run",
      selection,
    });
    const expectedPayloadHash = sha256(bundleEntry(bundle, "payload.json").bytes);
    const outcomes = await Promise.allSettled([
      publishScreenEvidenceBundleV1({ projectDirectory, bundle }),
      publishScreenEvidenceBundleV1({ projectDirectory, bundle }),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ScreenEvidenceExportErrorV1,
    );
    expect(
      ((rejected[0] as PromiseRejectedResult).reason as ScreenEvidenceExportErrorV1)
        .issueCode,
    ).toBe("EXPORT_RUN_EXISTS");

    const winner = (
      fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof publishScreenEvidenceBundleV1>>>
    ).value;
    expect(
      sha256(await readFile(path.join(winner.bundleDirectory, "payload.json"))),
    ).toBe(expectedPayloadHash);
    expect((await readdir(winner.bundleDirectory)).sort()).toEqual(
      ["COMPLETE", "manifest.json", "manifest.sha256", "payload.json"].sort(),
    );
  });

  it("preserves and rejects an interrupted bundle without COMPLETE", async () => {
    const { selection } = await buildSelectionFixture();
    const bundle = buildScreenEvidenceBundleV1({
      exportRunId: "interrupted-export-run",
      selection,
    });
    const projectDirectory = await makePrivateProject();
    const bundleDirectory = path.join(projectDirectory, bundle.bundleDirectoryName);
    await mkdir(bundleDirectory, { mode: 0o700 });
    await chmod(bundleDirectory, 0o700);
    for (const entry of bundle.entries.filter(
      (candidate) => candidate.relativePath !== "COMPLETE",
    )) {
      const absolutePath = path.join(bundleDirectory, entry.relativePath);
      await writeFile(absolutePath, entry.bytes, { mode: 0o600 });
      await chmod(absolutePath, 0o600);
    }

    const incomplete = cloneBundle(bundle);
    incomplete.entries = incomplete.entries.filter(
      (entry) => entry.relativePath !== "COMPLETE",
    );
    const importError = await captureError(() =>
      importScreenEvidenceBundleV1(
        incomplete as unknown as ScreenEvidenceBundleInputV1,
      ),
    );
    expect(importError).toBeInstanceOf(ScreenEvidenceImportErrorV1);
    const readError = await captureError(() =>
      readScreenEvidenceBundleV1({ bundleDirectory }),
    );
    expect(readError).toBeInstanceOf(ScreenEvidenceReadErrorV1);
    expect((await readdir(bundleDirectory)).sort()).toEqual(
      ["manifest.json", "manifest.sha256", "payload.json"].sort(),
    );
    await expect(access(bundleDirectory)).resolves.toBeUndefined();
  });

  it("does not create a completed publication after preflight or resource rejection", async () => {
    const { selection } = await buildSelectionFixture();
    const bundle = buildScreenEvidenceBundleV1({
      exportRunId: "rejected-export-run",
      selection,
    });
    const projectDirectory = await makePrivateProject();
    const incomplete = cloneBundle(bundle);
    incomplete.entries = incomplete.entries.filter(
      (entry) => entry.relativePath !== "COMPLETE",
    );
    await expectExportIssue(
      () =>
        publishScreenEvidenceBundleV1({
          projectDirectory,
          bundle: incomplete as unknown as ScreenEvidenceBundleInputV1,
        }),
      "BUNDLE_PREFLIGHT_REJECTED",
    );

    const oversized = cloneBundle(bundle);
    const payload = oversized.entries.find(
      (entry) => entry.relativePath === "payload.json",
    );
    if (payload === undefined) throw new Error("Missing payload fixture");
    payload.bytes = new Uint8Array(SCREEN_EVIDENCE_LIMITS_V1.payloadBytes + 1);
    payload.byteLength = payload.bytes.byteLength;
    await expectExportIssue(
      () =>
        publishScreenEvidenceBundleV1({
          projectDirectory,
          bundle: oversized as unknown as ScreenEvidenceBundleInputV1,
        }),
      "BUNDLE_PREFLIGHT_REJECTED",
    );

    const exportsDirectory = path.join(
      projectDirectory,
      PRIVATE_SCREEN_EVIDENCE_EXPORTS_RELATIVE_DIRECTORY_V1,
    );
    await expect(access(exportsDirectory)).rejects.toBeDefined();
  });
});

describe("private Screen Evidence budget evidence", () => {
  it("enforces zero, exact, one-over and invalid arithmetic with the production helper", () => {
    expect(accumulatePrivateScreenEvidenceBudgetV1(0, 0, 0)).toBe(0);
    expect(accumulatePrivateScreenEvidenceBudgetV1(0, 4, 10)).toBe(4);
    expect(accumulatePrivateScreenEvidenceBudgetV1(4, 6, 10)).toBe(10);
    expectBudgetIssue(
      () => accumulatePrivateScreenEvidenceBudgetV1(10, 1, 10),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectBudgetIssue(
      () => accumulatePrivateScreenEvidenceBudgetV1(0, -1, 10),
      "BUDGET_INPUT_INVALID",
    );
    expectBudgetIssue(
      () =>
        accumulatePrivateScreenEvidenceBudgetV1(
          Number.MAX_SAFE_INTEGER + 1,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
      "BUDGET_INPUT_INVALID",
    );
    expectBudgetIssue(
      () => accumulatePrivateScreenEvidenceBudgetV1(6, 0, 5),
      "BUDGET_INPUT_INVALID",
    );
    expectBudgetIssue(
      () =>
        accumulatePrivateScreenEvidenceBudgetV1(
          Number.MAX_SAFE_INTEGER,
          1,
          Number.MAX_SAFE_INTEGER,
        ),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("uses one cumulative budget for snapshot bytes and inventory scanned plus emitted entries", () => {
    const snapshotLimit = 12;
    let snapshotBytes = 0;
    for (const storedByteLength of [3, 4, 5]) {
      snapshotBytes = accumulatePrivateScreenEvidenceBudgetV1(
        snapshotBytes,
        storedByteLength,
        snapshotLimit,
      );
    }
    expect(snapshotBytes).toBe(snapshotLimit);
    expectBudgetIssue(
      () =>
        accumulatePrivateScreenEvidenceBudgetV1(
          snapshotBytes,
          1,
          snapshotLimit,
        ),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const inventoryLimit = 7;
    let inventoryEntries = 0;
    for (const scannedEntryDelta of [1, 2, 1]) {
      inventoryEntries = accumulatePrivateScreenEvidenceBudgetV1(
        inventoryEntries,
        scannedEntryDelta,
        inventoryLimit,
      );
    }
    for (const emittedEntryDelta of [1, 2]) {
      inventoryEntries = accumulatePrivateScreenEvidenceBudgetV1(
        inventoryEntries,
        emittedEntryDelta,
        inventoryLimit,
      );
    }
    expect(inventoryEntries).toBe(inventoryLimit);
    expectBudgetIssue(
      () =>
        accumulatePrivateScreenEvidenceBudgetV1(
          inventoryEntries,
          1,
          inventoryLimit,
        ),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("checks a direct caller snapshot exact cap before identity and rejects one-over before traversal", async () => {
    const exactSnapshot = compactDeclaredByteSnapshot(
      PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes,
    );
    expect(exactSnapshot.records).toHaveLength(
      Math.ceil(
        PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes /
          PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.recordBytes,
      ),
    );
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot: exactSnapshot,
          window: { startEpochMs: 0, endEpochMs: 200_000 },
          asOfEpochMs: 200_000,
          privacyReviewReceipts: [],
        }),
      "SNAPSHOT_INVALID",
    );

    const oneOverSnapshot = compactDeclaredByteSnapshot(
      PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.snapshotBytes + 1,
    );
    expect(oneOverSnapshot.records).toHaveLength(
      exactSnapshot.records.length + 1,
    );
    expect(oneOverSnapshot.records.at(-1)?.byteLength).toBe(1);
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot: oneOverSnapshot,
          window: { startEpochMs: 0, endEpochMs: 200_000 },
          asOfEpochMs: 200_000,
          privacyReviewReceipts: [],
        }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });
});

describe("private Screen Evidence receipt temporal boundaries", () => {
  it("accepts capture == review == asOf and rejects each strict temporal inversion", async () => {
    const projectDirectory = await makePrivateProject();
    const stored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory,
      record: fixtureRecord({
        captureId: "capture-temporal-boundary",
        capturedAtEpochMs: 1_000,
      }),
    });
    const snapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
      projectDirectory,
      recordRefs: [
        { captureId: "capture-temporal-boundary", revision: 1 },
      ],
    });
    const window = { startEpochMs: 1_000, endEpochMs: 1_000 };

    const equality = selectPrivateScreenEvidenceForExportV1({
      snapshot,
      window,
      asOfEpochMs: 1_000,
      privacyReviewReceipts: [
        approvedPrivacyReceipt(stored, { reviewedAtEpochMs: 1_000 }),
      ],
    });
    expect(equality.records).toHaveLength(1);
    expect(equality.asOfEpochMs).toBe(1_000);
    expect(equality.privacyReviewReceipts[0]?.reviewedAtEpochMs).toBe(1_000);

    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot,
          window,
          asOfEpochMs: 1_001,
          privacyReviewReceipts: [
            approvedPrivacyReceipt(stored, { reviewedAtEpochMs: 999 }),
          ],
        }),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot,
          window,
          asOfEpochMs: 999,
          privacyReviewReceipts: [],
        }),
      "SELECTION_INVALID",
    );
    await expectStoreIssue(
      () =>
        selectPrivateScreenEvidenceForExportV1({
          snapshot,
          window,
          asOfEpochMs: 1_000,
          privacyReviewReceipts: [
            approvedPrivacyReceipt(stored, { reviewedAtEpochMs: 1_001 }),
          ],
        }),
      "SELECTION_INVALID",
    );
  });
});

describe("private Screen Evidence COMPLETE publication fault evidence", () => {
  it("keeps COMPLETE last across the ordered pre-commit, commit and post-commit fault matrix", async () => {
    const { projectDirectory, selection } = await buildSelectionFixture();
    const fullEventOrder: readonly PrivateScreenEvidencePublicationEventKindV1[] = [
      "DIRECTORY_CREATED",
      "PAYLOAD_COMMITTED",
      "MANIFEST_COMMITTED",
      "MANIFEST_MARKER_COMMITTED",
      "BEFORE_COMPLETE",
      "COMPLETE_COMMIT_STARTED",
      "COMPLETE_COMMITTED",
      "BEFORE_FINAL_READBACK",
    ];
    const winnerBundle = buildScreenEvidenceBundleV1({
      exportRunId: "fault-matrix-existing-winner",
      selection,
    });
    const winnerEvents: PrivateScreenEvidencePublicationEventKindV1[] = [];
    const winnerPublication = await publishScreenEvidenceBundleV1Internal(
      { projectDirectory, bundle: winnerBundle },
      {
        onEvent(event) {
          winnerEvents.push(event.kind);
        },
      },
    );
    expect(winnerEvents).toEqual(fullEventOrder);
    expect(winnerEvents.indexOf("COMPLETE_COMMITTED")).toBeGreaterThan(
      winnerEvents.indexOf("MANIFEST_MARKER_COMMITTED"),
    );
    const winnerBytes = new Map<string, Uint8Array>();
    for (const fileName of SCREEN_EVIDENCE_BUNDLE_FILES_V1) {
      winnerBytes.set(
        fileName,
        new Uint8Array(
          await readFile(path.join(winnerPublication.bundleDirectory, fileName)),
        ),
      );
    }

    const faultCases: readonly Readonly<{
      suffix: string;
      eventKind: PrivateScreenEvidencePublicationEventKindV1;
      classification: PrivateScreenEvidencePublicationFaultClassificationV1;
      expectedFiles: readonly string[];
    }>[] = [
      {
        suffix: "after-directory",
        eventKind: "DIRECTORY_CREATED",
        classification: "BEFORE_COMPLETE",
        expectedFiles: [],
      },
      {
        suffix: "after-payload",
        eventKind: "PAYLOAD_COMMITTED",
        classification: "BEFORE_COMPLETE",
        expectedFiles: ["payload.json"],
      },
      {
        suffix: "after-manifest",
        eventKind: "MANIFEST_COMMITTED",
        classification: "BEFORE_COMPLETE",
        expectedFiles: ["payload.json", "manifest.json"],
      },
      {
        suffix: "after-manifest-marker",
        eventKind: "MANIFEST_MARKER_COMMITTED",
        classification: "BEFORE_COMPLETE",
        expectedFiles: ["payload.json", "manifest.json", "manifest.sha256"],
      },
      {
        suffix: "before-complete",
        eventKind: "BEFORE_COMPLETE",
        classification: "BEFORE_COMPLETE",
        expectedFiles: ["payload.json", "manifest.json", "manifest.sha256"],
      },
      {
        suffix: "during-complete",
        eventKind: "COMPLETE_COMMIT_STARTED",
        classification: "DURING_COMPLETE",
        expectedFiles: ["payload.json", "manifest.json", "manifest.sha256"],
      },
      {
        suffix: "after-complete-before-readback",
        eventKind: "BEFORE_FINAL_READBACK",
        classification: "AFTER_COMPLETE",
        expectedFiles: [
          "payload.json",
          "manifest.json",
          "manifest.sha256",
          "COMPLETE",
        ],
      },
    ];

    for (const faultCase of faultCases) {
      const bundle = buildScreenEvidenceBundleV1({
        exportRunId: `fault-matrix-${faultCase.suffix}`,
        selection,
      });
      const events: PrivateScreenEvidencePublicationEventKindV1[] = [];
      const fault = await captureError(() =>
        publishScreenEvidenceBundleV1Internal(
          { projectDirectory, bundle },
          {
            onEvent(event) {
              events.push(event.kind);
              if (event.kind === faultCase.eventKind) {
                throw new PrivateScreenEvidencePublicationFaultV1(
                  faultCase.classification,
                  faultCase.eventKind,
                );
              }
            },
          },
        ),
      );
      expect(fault).toBeInstanceOf(PrivateScreenEvidencePublicationFaultV1);
      expect(
        (fault as PrivateScreenEvidencePublicationFaultV1).issueCode,
      ).toBe("INJECTED_PUBLICATION_FAULT");
      expect(
        (fault as PrivateScreenEvidencePublicationFaultV1).classification,
      ).toBe(faultCase.classification);
      expect(
        (fault as PrivateScreenEvidencePublicationFaultV1).eventKind,
      ).toBe(faultCase.eventKind);
      expect(events).toEqual(
        fullEventOrder.slice(0, fullEventOrder.indexOf(faultCase.eventKind) + 1),
      );

      const bundleDirectory = path.join(
        projectDirectory,
        PRIVATE_SCREEN_EVIDENCE_EXPORTS_RELATIVE_DIRECTORY_V1,
        bundle.bundleDirectoryName,
      );
      const actualFiles = (await readdir(bundleDirectory)).sort();
      expect(actualFiles).toEqual([...faultCase.expectedFiles].sort());
      for (const fileName of faultCase.expectedFiles) {
        expect(
          new Uint8Array(await readFile(path.join(bundleDirectory, fileName))),
        ).toEqual(bundleEntry(bundle, fileName).bytes);
      }

      if (faultCase.classification === "AFTER_COMPLETE") {
        expect(actualFiles).toContain("COMPLETE");
        const readback = await readScreenEvidenceBundleV1({ bundleDirectory });
        expect(readback.imported.evidence.exportRunId).toBe(
          bundle.bundleDirectoryName,
        );
      } else {
        expect(actualFiles).not.toContain("COMPLETE");
        const readError = await captureError(() =>
          readScreenEvidenceBundleV1({ bundleDirectory }),
        );
        expect(readError).toBeInstanceOf(ScreenEvidenceReadErrorV1);

        const partialBundle = cloneBundle(bundle);
        partialBundle.entries = partialBundle.entries.filter((entry) =>
          faultCase.expectedFiles.includes(entry.relativePath),
        );
        const importError = await captureError(() =>
          importScreenEvidenceBundleV1(
            partialBundle as unknown as ScreenEvidenceBundleInputV1,
          ),
        );
        expect(importError).toBeInstanceOf(ScreenEvidenceImportErrorV1);
      }
    }

    expect(
      (await readdir(winnerPublication.bundleDirectory)).sort(),
    ).toEqual([...SCREEN_EVIDENCE_BUNDLE_FILES_V1].sort());
    for (const fileName of SCREEN_EVIDENCE_BUNDLE_FILES_V1) {
      expect(
        new Uint8Array(
          await readFile(path.join(winnerPublication.bundleDirectory, fileName)),
        ),
      ).toEqual(winnerBytes.get(fileName));
    }
  }, 30_000);
});

describe("private Screen Evidence genuine process contention", () => {
  it("selects one byte-exact store winner across barrier-synchronized processes and reopens it in a fresh process", async () => {
    const projectDirectory = await makePrivateProject();
    const coordinationDirectory = await makePrivateProject();
    const captureHash = sha256Text("capture-process-race");
    await createPrivateDirectoryChain(
      projectDirectory,
      `${PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1}/captures/${captureHash}/revisions`,
    );
    const startPath = path.join(coordinationDirectory, "store.start");
    const readyA = path.join(coordinationDirectory, "store-a.ready");
    const readyB = path.join(coordinationDirectory, "store-b.ready");
    const recordA = fixtureRecord({
      captureId: "capture-process-race",
      ocrText: "Synthetic process contender A",
      applicationLabel: "Synthetic contender application A",
    });
    const recordB = fixtureRecord({
      captureId: "capture-process-race",
      ocrText: "Synthetic process contender B",
      applicationLabel: "Synthetic contender application B",
    });
    const expectedA = canonicalPrivateScreenEvidenceJsonBytesV1(recordA);
    const expectedB = canonicalPrivateScreenEvidenceJsonBytesV1(recordB);
    const expectedByHash = new Map([
      [sha256(expectedA), { bytes: expectedA, record: recordA }],
      [sha256(expectedB), { bytes: expectedB, record: recordB }],
    ]);
    const barrierA = { readyPath: readyA, startPath, timeoutMs: 10_000 };
    const barrierB = { readyPath: readyB, startPath, timeoutMs: 10_000 };
    const childA = runChildDriver(coordinationDirectory, "store-a", {
      operation: "store-write",
      projectDirectory,
      record: recordA,
      barrier: barrierA,
    });
    const childB = runChildDriver(coordinationDirectory, "store-b", {
      operation: "store-write",
      projectDirectory,
      record: recordB,
      barrier: barrierB,
    });
    await waitForPaths([readyA, readyB]);
    await writeFile(startPath, "start\n", { mode: 0o600 });
    await chmod(startPath, 0o600);
    const results = await Promise.all([childA, childB]);
    const fulfilled = fulfilledChildValues(results);
    const rejected = rejectedChildValues(results);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.issueCode).toBe("REVISION_EXISTS");

    const winner = fulfilled[0]?.value as ChildStoredValue;
    const expectedWinner = expectedByHash.get(winner.rawSha256);
    if (expectedWinner === undefined) {
      throw new Error("Child store winner did not match either canonical input");
    }
    const capturesDirectory = path.join(
      projectDirectory,
      PRIVATE_SCREEN_EVIDENCE_STORE_RELATIVE_DIRECTORY_V1,
      "captures",
    );
    const captureDirectory = path.join(capturesDirectory, captureHash);
    const revisionsDirectory = path.join(captureDirectory, "revisions");
    const absoluteRecordPath = path.join(revisionsDirectory, "1.json");
    expect(new Uint8Array(await readFile(absoluteRecordPath))).toEqual(
      expectedWinner.bytes,
    );
    expect(await readdir(capturesDirectory)).toEqual([captureHash]);
    expect(await readdir(captureDirectory)).toEqual(["revisions"]);
    expect(await readdir(revisionsDirectory)).toEqual(["1.json"]);

    const freshRead = await runChildDriver(
      coordinationDirectory,
      "store-fresh-read",
      {
        operation: "store-read",
        projectDirectory,
        captureId: "capture-process-race",
        revision: 1,
      },
    );
    expect(freshRead.status).toBe("fulfilled");
    const freshValue = (freshRead as ChildDriverFulfilledResult)
      .value as ChildStoredValue;
    expect(freshValue.rawSha256).toBe(winner.rawSha256);
    expect(freshValue.record).toEqual(expectedWinner.record);
  }, 30_000);

  it("selects one unmixed export winner across barrier-synchronized processes and reopens it in a fresh process", async () => {
    const preparationDirectory = await makePrivateProject();
    const firstStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: preparationDirectory,
      record: fixtureRecord({
        captureId: "capture-process-export-a",
        capturedAtEpochMs: 1_000,
        ocrText: "Synthetic export contender A",
      }),
    });
    const secondStored = await writePrivateScreenEvidenceCaptureRevisionV1({
      projectDirectory: preparationDirectory,
      record: fixtureRecord({
        captureId: "capture-process-export-b",
        capturedAtEpochMs: 1_100,
        ocrText: "Synthetic export contender B",
      }),
    });
    const bundleForStored = async (
      stored: StoredPrivateScreenEvidenceCaptureRevisionV1,
    ): Promise<ScreenEvidenceBundleInputV1> => {
      const snapshot = await readPrivateScreenEvidenceStoreSnapshotV1({
        projectDirectory: preparationDirectory,
        recordRefs: [
          {
            captureId: stored.record.capture.captureId,
            revision: stored.record.capture.revision,
          },
        ],
      });
      const selection = selectPrivateScreenEvidenceForExportV1({
        snapshot,
        window: {
          startEpochMs: stored.record.capture.capturedAtEpochMs,
          endEpochMs: stored.record.capture.capturedAtEpochMs,
        },
        asOfEpochMs: 1_500,
        privacyReviewReceipts: [approvedPrivacyReceipt(stored)],
      });
      return buildScreenEvidenceBundleV1({
        exportRunId: "process-export-race",
        selection,
      });
    };
    const bundleA = await bundleForStored(firstStored);
    const bundleB = await bundleForStored(secondStored);
    const expectedByPayloadHash = new Map([
      [sha256(bundleEntry(bundleA, "payload.json").bytes), bundleA],
      [sha256(bundleEntry(bundleB, "payload.json").bytes), bundleB],
    ]);

    const publicationDirectory = await makePrivateProject();
    await createPrivateDirectoryChain(
      publicationDirectory,
      PRIVATE_SCREEN_EVIDENCE_EXPORTS_RELATIVE_DIRECTORY_V1,
    );
    const coordinationDirectory = await makePrivateProject();
    const startPath = path.join(coordinationDirectory, "export.start");
    const readyA = path.join(coordinationDirectory, "export-a.ready");
    const readyB = path.join(coordinationDirectory, "export-b.ready");
    const childA = runChildDriver(coordinationDirectory, "export-a", {
      operation: "publish",
      projectDirectory: publicationDirectory,
      bundle: serializeChildBundle(bundleA),
      barrier: { readyPath: readyA, startPath, timeoutMs: 10_000 },
    });
    const childB = runChildDriver(coordinationDirectory, "export-b", {
      operation: "publish",
      projectDirectory: publicationDirectory,
      bundle: serializeChildBundle(bundleB),
      barrier: { readyPath: readyB, startPath, timeoutMs: 10_000 },
    });
    await waitForPaths([readyA, readyB]);
    await writeFile(startPath, "start\n", { mode: 0o600 });
    await chmod(startPath, 0o600);
    const results = await Promise.all([childA, childB]);
    const fulfilled = fulfilledChildValues(results);
    const rejected = rejectedChildValues(results);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.issueCode).toBe("EXPORT_RUN_EXISTS");

    const winner = fulfilled[0]?.value as ChildPublishedValue;
    const expectedWinner = expectedByPayloadHash.get(winner.payloadSha256);
    if (expectedWinner === undefined) {
      throw new Error("Child export winner did not match either canonical bundle");
    }
    const exportsDirectory = path.join(
      publicationDirectory,
      PRIVATE_SCREEN_EVIDENCE_EXPORTS_RELATIVE_DIRECTORY_V1,
    );
    const bundleDirectory = path.join(exportsDirectory, "process-export-race");
    expect(await readdir(exportsDirectory)).toEqual(["process-export-race"]);
    expect((await readdir(bundleDirectory)).sort()).toEqual(
      [...SCREEN_EVIDENCE_BUNDLE_FILES_V1].sort(),
    );
    for (const fileName of SCREEN_EVIDENCE_BUNDLE_FILES_V1) {
      expect(
        new Uint8Array(await readFile(path.join(bundleDirectory, fileName))),
      ).toEqual(bundleEntry(expectedWinner, fileName).bytes);
    }

    const freshRead = await runChildDriver(
      coordinationDirectory,
      "export-fresh-read",
      { operation: "bundle-read", bundleDirectory },
    );
    expect(freshRead.status).toBe("fulfilled");
    const freshValue = (freshRead as ChildDriverFulfilledResult)
      .value as ChildBundleReadValue;
    expect(freshValue.exportRunId).toBe("process-export-race");
    expect(freshValue.payloadSha256).toBe(winner.payloadSha256);
    expect(freshValue.manifestSha256).toBe(winner.manifestSha256);
  }, 30_000);
});
