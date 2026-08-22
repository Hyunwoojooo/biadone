import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  dayflowExportManifestSha256,
  dayflowScreenEvidenceExportSchema,
  jcsCanonicalize,
} from "../src/dayflowEvidence/contracts";
import {
  DAYFLOW_E2_IO_LIMITS,
  DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_SCHEMA_VERSION,
  importDayflowEvidenceBundle,
  sealDayflowEvidenceBundleCompletion,
  type ImportDayflowEvidenceBundleInput,
  type ImportedDayflowEvidenceBundle,
} from "../src/evaluation/dayflowAblation/importEvidenceBundle";
import {
  DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS,
  DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1,
  captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1,
  captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1,
  copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1,
  copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1,
  reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1,
  type CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1,
  type DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1,
} from "../src/evaluation/dayflowAblation/preprocessedEvidenceVerificationSnapshotV0_1";

const ZERO_HASH = "0".repeat(64);
const ONE_HASH = "1".repeat(64);
const TWO_HASH = "2".repeat(64);
const START = "2026-08-17T00:00:00.000Z";
const END = "2026-08-17T00:00:01.000Z";
const COMPLETED = "2026-08-17T00:00:02.000Z";
const BUNDLE_ID = "synthetic-e2schema-snapshot-bundle-1";
const encoder = new TextEncoder();
const CANDIDATE_BYTES = Uint8Array.from([0x7b, 0x7d, 0x0a]);

type Fixture = Readonly<{
  input: ImportDayflowEvidenceBundleInput;
  expected: ImportedDayflowEvidenceBundle;
}>;

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(`${jcsCanonicalize(value)}\n`);
}

function buildFixture(): Fixture {
  const manifestWithoutHash = {
    contract: "dayflow-screen-evidence-export-v0.1" as const,
    schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
    exportId: "synthetic-e2schema-snapshot-export-1",
    lineageClass: "evidence" as const,
    dataOrigin: "synthetic" as const,
    studyPhase: "contract_conformance" as const,
    studyProtocolHash: ZERO_HASH,
    exportedAt: END,
    windowStart: START,
    windowEnd: END,
    dayflowCommitSha: "a".repeat(40),
    sourceFileHashes: [
      { relativePath: "Sources/ScreenRecorder.swift", sha256: ZERO_HASH },
    ],
    packageResolvedSha256: ONE_HASH,
    capturePolicyVersion: "capture-v0.1",
    captureConfig: {
      captureIntervalMs: "1000",
      maxWindowDurationMs: "1000",
      maxArtifactsPerExport: "256",
      maxBlobBytes: String(DAYFLOW_E2_IO_LIMITS.objectBytes),
      allowedMimeTypes: ["image/jpeg" as const],
    },
    databaseSnapshotIdentity: {
      snapshotKind: "synthetic-fixture" as const,
      fixtureSetId: "synthetic-e2schema-snapshot-fixture-set-1",
      fixtureGeneratorVersion: "synthetic-e2schema-snapshot-generator-v0.1",
      fixtureGeneratorSeed: "synthetic-e2schema-snapshot-seed-1",
      fixtureGeneratorConfigSha256: TWO_HASH,
    },
    consentRevision: "synthetic-consent-v0.1",
    retentionPolicyId: "synthetic-retention-v0.1",
    coverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: "paused" as const,
          expectedFrameCount: 0,
          observedFrameCount: 0,
          rejectedFrameCount: 0,
        },
      ],
      expectedFrameCount: 0,
      observedFrameCount: 0,
      rejectedFrameCount: 0,
    },
    artifacts: [],
  };
  const manifest = dayflowScreenEvidenceExportSchema.parse({
    ...manifestWithoutHash,
    detachedManifestSha256:
      dayflowExportManifestSha256(manifestWithoutHash),
  });
  const manifestBytes = canonicalBytes(manifest);
  const completion = sealDayflowEvidenceBundleCompletion({
    completionSchemaVersion:
      DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_SCHEMA_VERSION,
    bundleId: BUNDLE_ID,
    exportId: manifest.exportId,
    manifestRelativePath: "manifest.json",
    manifestByteLength: manifestBytes.byteLength,
    manifestRawSha256: rawSha256(manifestBytes),
    manifestDetachedSha256: manifest.detachedManifestSha256,
    objectCount: 0,
    totalObjectBytes: 0,
    completedAt: COMPLETED,
  });
  const completionBytes = canonicalBytes(completion);
  const input = {
    mode: "synthetic-contract-conformance" as const,
    bundleId: BUNDLE_ID,
    entries: [
      {
        relativePath: "manifest.json",
        entryKind: "regular-file" as const,
        byteLength: manifestBytes.byteLength,
        bytes: manifestBytes,
      },
      {
        relativePath: "COMPLETE",
        entryKind: "regular-file" as const,
        byteLength: completionBytes.byteLength,
        bytes: completionBytes,
      },
    ],
  };
  return { input, expected: importDayflowEvidenceBundle(input) };
}

function captureInput(
  fixture: Fixture,
  overrides: Partial<
    CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1
  > = {},
): CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1 {
  return {
    candidateBytes: CANDIDATE_BYTES,
    originalBundle: fixture.input,
    expectedImportedBundleDescriptor: fixture.expected,
    ...overrides,
  };
}

function expectSnapshotIssue(
  candidate: unknown,
  issueCode: DayflowPreprocessedEvidenceVerificationSnapshotIssueCodeV0_1,
): void {
  try {
    captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
      candidate as CaptureOwnedPreprocessedEvidenceVerificationSnapshotInputV0_1,
    );
    throw new TypeError("Expected snapshot capture to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(
      DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1,
    );
    if (
      !(error instanceof
        DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1)
    ) {
      throw error;
    }
    expect(error.issueCode).toBe(issueCode);
    expect(error.message).toBe(
      `Dayflow preprocessed evidence snapshot failed (${issueCode})`,
    );
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).toBe(
      JSON.stringify({ issueCode }),
    );
  }
}

function cloneBundle(
  input: ImportDayflowEvidenceBundleInput,
): {
  mode: "synthetic-contract-conformance";
  bundleId: string;
  entries: Array<{
    relativePath: string;
    entryKind: "regular-file";
    byteLength: number;
    bytes: Uint8Array;
  }>;
} {
  return {
    mode: input.mode,
    bundleId: input.bundleId,
    entries: input.entries.map((entry) => ({
      relativePath: entry.relativePath,
      entryKind: entry.entryKind,
      byteLength: entry.byteLength,
      bytes: new Uint8Array(entry.bytes),
    })),
  };
}

function replaceEntryBytes(
  input: ImportDayflowEvidenceBundleInput,
  index: number,
  bytes: Uint8Array,
  declaredByteLength = bytes.byteLength,
): ImportDayflowEvidenceBundleInput {
  return {
    mode: input.mode,
    bundleId: input.bundleId,
    entries: input.entries.map((entry, entryIndex) =>
      entryIndex === index
        ? {
            relativePath: entry.relativePath,
            entryKind: entry.entryKind,
            byteLength: declaredByteLength,
            bytes,
          }
        : entry,
    ),
  };
}

function makeDetachedBytes(source: Uint8Array): Uint8Array {
  const buffer = new ArrayBuffer(source.byteLength);
  const view = new Uint8Array(buffer);
  view.set(source);
  structuredClone(buffer, { transfer: [buffer] });
  return view;
}

function objectEntry(
  index: number,
  bytes: Uint8Array,
): Readonly<{
  relativePath: string;
  entryKind: "regular-file";
  byteLength: number;
  bytes: Uint8Array;
}> {
  return {
    relativePath:
      "objects/sha256/" +
      (index + 1).toString(16).padStart(64, "0") +
      ".jpg",
    entryKind: "regular-file",
    byteLength: bytes.byteLength,
    bytes,
  };
}

describe("E2-SCHEMA-2B-1 owned verification snapshot", () => {
  it("captures, reverifies, and returns only fresh copies", () => {
    const fixture = buildFixture();
    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureInput(fixture),
      );

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Reflect.ownKeys(snapshot)).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe("{}");
    expect(
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(snapshot),
    ).toEqual(fixture.expected);

    const firstCandidate =
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    const secondCandidate =
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    expect(firstCandidate).toEqual(CANDIDATE_BYTES);
    expect(secondCandidate).toEqual(CANDIDATE_BYTES);
    expect(firstCandidate).not.toBe(secondCandidate);

    const firstBundle =
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    const secondBundle =
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    expect(firstBundle).toEqual(fixture.input);
    expect(firstBundle).not.toBe(secondBundle);
    expect(firstBundle.entries).not.toBe(secondBundle.entries);
    expect(firstBundle.entries[0]!.bytes).not.toBe(
      secondBundle.entries[0]!.bytes,
    );
    expect(Object.isFrozen(firstBundle)).toBe(true);
    expect(Object.isFrozen(firstBundle.entries)).toBe(true);
    expect(Object.isFrozen(firstBundle.entries[0])).toBe(true);

    firstCandidate[0] ^= 0xff;
    firstBundle.entries[0]!.bytes[0] ^= 0xff;
    expect(
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      ),
    ).toEqual(CANDIDATE_BYTES);
    expect(
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(snapshot),
    ).toEqual(fixture.expected);
  });

  it("retains no caller references after successful capture", () => {
    const fixture = buildFixture();
    const candidateBytes = new Uint8Array(CANDIDATE_BYTES);
    const originalBundle = cloneBundle(fixture.input);
    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1({
        candidateBytes,
        originalBundle,
        expectedImportedBundleDescriptor: fixture.expected,
      });
    const originalManifestPath = originalBundle.entries[0]!.relativePath;

    candidateBytes.fill(0xff);
    originalBundle.bundleId = "mutated-after-capture";
    originalBundle.entries[0]!.relativePath = "mutated-after-capture";
    originalBundle.entries[0]!.bytes.fill(0xff);
    originalBundle.entries.length = 0;

    expect(
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      ),
    ).toEqual(CANDIDATE_BYTES);
    const copiedBundle =
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    expect(copiedBundle.bundleId).toBe(BUNDLE_ID);
    expect(copiedBundle.entries[0]!.relativePath).toBe(originalManifestPath);
    expect(
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(snapshot),
    ).toEqual(fixture.expected);
  });

  it("fails closed on descriptor mismatch and importer rejection", () => {
    const fixture = buildFixture();
    expectSnapshotIssue(
      captureInput(fixture, {
        expectedImportedBundleDescriptor: {
          ...fixture.expected,
          replayIdentitySha256: ZERO_HASH,
        },
      }),
      "IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH",
    );

    const tamperedManifest = new Uint8Array(fixture.input.entries[0]!.bytes);
    tamperedManifest[0] ^= 0xff;
    const importerInvalidInput = captureInput(fixture, {
      originalBundle: replaceEntryBytes(
        fixture.input,
        0,
        tamperedManifest,
      ),
    });
    const captureOnly =
      captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1(
        importerInvalidInput,
      );
    expect(Object.getPrototypeOf(captureOnly)).toBeNull();
    expect(Object.keys(captureOnly)).toEqual([]);
    expect(Object.isFrozen(captureOnly)).toBe(true);

    let explicitReverifyError: unknown;
    try {
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(captureOnly);
    } catch (error) {
      explicitReverifyError = error;
    }
    expect(explicitReverifyError).toBeInstanceOf(
      DayflowPreprocessedEvidenceVerificationSnapshotErrorV0_1,
    );
    expect(explicitReverifyError).toMatchObject({
      issueCode: "BUNDLE_IMPORT_REJECTED",
    });

    expectSnapshotIssue(
      importerInvalidInput,
      "BUNDLE_IMPORT_REJECTED",
    );
  });

  it("capture-only owns caller data and returns independent fresh copies", () => {
    const fixture = buildFixture();
    const mutableExpectedDescriptor = { ...fixture.expected };
    const input = captureInput(fixture, {
      candidateBytes: new Uint8Array(CANDIDATE_BYTES),
      expectedImportedBundleDescriptor: mutableExpectedDescriptor,
    });
    const expectedCandidate = new Uint8Array(input.candidateBytes);
    const expectedManifest = new Uint8Array(
      input.originalBundle.entries[0]!.bytes,
    );
    const captureOnly =
      captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1(input);

    input.candidateBytes[0] = (input.candidateBytes[0] ?? 0) ^ 0xff;
    const callerManifest = input.originalBundle.entries[0]!.bytes;
    callerManifest[0] = (callerManifest[0] ?? 0) ^ 0xff;
    mutableExpectedDescriptor.replayIdentitySha256 = ZERO_HASH;

    expect(
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(captureOnly),
    ).toEqual(fixture.expected);

    const firstCandidateCopy =
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureOnly,
      );
    expect(firstCandidateCopy).toEqual(expectedCandidate);
    firstCandidateCopy[0] = (firstCandidateCopy[0] ?? 0) ^ 0xff;
    expect(
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureOnly,
      ),
    ).toEqual(expectedCandidate);

    const firstBundleCopy =
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureOnly,
      );
    expect(firstBundleCopy.entries[0]!.bytes).toEqual(expectedManifest);
    firstBundleCopy.entries[0]!.bytes[0] =
      (firstBundleCopy.entries[0]!.bytes[0] ?? 0) ^ 0xff;
    expect(
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureOnly,
      ).entries[0]!.bytes,
    ).toEqual(expectedManifest);
  });

  it("validates structure and every byte input before resource caps", () => {
    const fixture = buildFixture();
    const oversizedCandidate = new Uint8Array(
      DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.candidateBytes +
        1,
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: oversizedCandidate,
        expectedImportedBundleDescriptor: {
          ...fixture.expected,
          replayIdentitySha256: "invalid-hash",
        },
      }),
      "INPUT_INVALID",
    );

    const completionIndex = fixture.input.entries.length - 1;
    const completion = fixture.input.entries[completionIndex]!;
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: oversizedCandidate,
        originalBundle: replaceEntryBytes(
          fixture.input,
          completionIndex,
          makeDetachedBytes(completion.bytes),
          completion.byteLength,
        ),
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: oversizedCandidate,
        originalBundle: replaceEntryBytes(
          fixture.input,
          completionIndex,
          completion.bytes,
          completion.byteLength + 1,
        ),
      }),
      "INPUT_INVALID",
    );

    const oversizedManifest = new Uint8Array(
      DAYFLOW_E2_IO_LIMITS.manifestBytes + 1,
    );
    const earlyOversizedBundle = replaceEntryBytes(
      fixture.input,
      0,
      oversizedManifest,
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: replaceEntryBytes(
          earlyOversizedBundle,
          completionIndex,
          makeDetachedBytes(completion.bytes),
          completion.byteLength,
        ),
      }),
      "INPUT_INVALID",
    );

    expectSnapshotIssue(
      captureInput(fixture, { candidateBytes: oversizedCandidate }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectSnapshotIssue(
      captureInput(fixture, { originalBundle: earlyOversizedBundle }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("copies the expected descriptor before caller mutation", () => {
    const fixture = buildFixture();
    const mutableExpected = { ...fixture.expected };
    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureInput(fixture, {
          expectedImportedBundleDescriptor: mutableExpected,
        }),
      );
    const mutableRecord = mutableExpected as unknown as Record<
      string,
      unknown
    >;
    mutableRecord.importSchemaVersion = "mutated-after-capture";
    mutableRecord.manifestRawSha256 = ZERO_HASH;
    mutableRecord.manifestDetachedSha256 = ZERO_HASH;
    mutableRecord.completionSha256 = ZERO_HASH;
    mutableRecord.objectCount = 1;
    mutableRecord.totalObjectBytes = 1;
    mutableRecord.replayIdentitySha256 = ZERO_HASH;

    expect(
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(snapshot),
    ).toEqual(fixture.expected);
  });

  it("rejects valid-shape mismatches for all non-literal descriptor fields", () => {
    const fixture = buildFixture();
    const differentHash = (value: string) =>
      value === ZERO_HASH ? ONE_HASH : ZERO_HASH;
    const mismatches: Array<Partial<ImportedDayflowEvidenceBundle>> = [
      {
        manifestRawSha256: differentHash(
          fixture.expected.manifestRawSha256,
        ),
      },
      {
        manifestDetachedSha256: differentHash(
          fixture.expected.manifestDetachedSha256,
        ),
      },
      {
        completionSha256: differentHash(
          fixture.expected.completionSha256,
        ),
      },
      { objectCount: fixture.expected.objectCount + 1 },
      { totalObjectBytes: fixture.expected.totalObjectBytes + 1 },
      {
        replayIdentitySha256: differentHash(
          fixture.expected.replayIdentitySha256,
        ),
      },
    ];
    for (const mismatch of mismatches) {
      expectSnapshotIssue(
        captureInput(fixture, {
          expectedImportedBundleDescriptor: {
            ...fixture.expected,
            ...mismatch,
          },
        }),
        "IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH",
      );
    }

    expectSnapshotIssue(
      captureInput(fixture, {
        expectedImportedBundleDescriptor: {
          ...fixture.expected,
          importSchemaVersion:
            "dayflow-screen-evidence-bundle-import-v9.9",
        } as unknown as ImportedDayflowEvidenceBundle,
      }),
      "INPUT_INVALID",
    );
  });

  it("rejects accessors without invoking their values", () => {
    const fixture = buildFixture();
    let getterCalls = 0;
    const getter = () => {
      getterCalls += 1;
      throw new Error("caller getter must not run");
    };

    const rootAccessor = {
      originalBundle: fixture.input,
      expectedImportedBundleDescriptor: fixture.expected,
    } as Record<string, unknown>;
    Object.defineProperty(rootAccessor, "candidateBytes", {
      enumerable: true,
      get: getter,
    });
    expectSnapshotIssue(rootAccessor, "INPUT_INVALID");

    const bundleAccessor = {
      bundleId: BUNDLE_ID,
      entries: fixture.input.entries,
    } as Record<string, unknown>;
    Object.defineProperty(bundleAccessor, "mode", {
      enumerable: true,
      get: getter,
    });
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle:
          bundleAccessor as unknown as ImportDayflowEvidenceBundleInput,
      }),
      "INPUT_INVALID",
    );

    const entryAccessor = {
      relativePath: "manifest.json",
      entryKind: "regular-file",
      byteLength: fixture.input.entries[0]!.byteLength,
    } as Record<string, unknown>;
    Object.defineProperty(entryAccessor, "bytes", {
      enumerable: true,
      get: getter,
    });
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [
            entryAccessor as unknown as
              ImportDayflowEvidenceBundleInput["entries"][number],
            fixture.input.entries[1]!,
          ],
        },
      }),
      "INPUT_INVALID",
    );

    const descriptorAccessor = {
      ...fixture.expected,
    } as Record<string, unknown>;
    delete descriptorAccessor.replayIdentitySha256;
    Object.defineProperty(
      descriptorAccessor,
      "replayIdentitySha256",
      { enumerable: true, get: getter },
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        expectedImportedBundleDescriptor:
          descriptorAccessor as unknown as ImportedDayflowEvidenceBundle,
      }),
      "INPUT_INVALID",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects extra keys, sparse arrays, and nonplain metadata", () => {
    const fixture = buildFixture();
    expectSnapshotIssue(
      { ...captureInput(fixture), extra: true },
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          extra: true,
        } as unknown as ImportDayflowEvidenceBundleInput,
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        expectedImportedBundleDescriptor: {
          ...fixture.expected,
          extra: true,
        } as unknown as ImportedDayflowEvidenceBundle,
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [
            {
              ...fixture.input.entries[0]!,
              extra: true,
            } as unknown as
              ImportDayflowEvidenceBundleInput["entries"][number],
            fixture.input.entries[1]!,
          ],
        },
      }),
      "INPUT_INVALID",
    );

    const sparseEntries = new Array(2) as Array<
      ImportDayflowEvidenceBundleInput["entries"][number]
    >;
    sparseEntries[0] = fixture.input.entries[0]!;
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: { ...fixture.input, entries: sparseEntries },
      }),
      "INPUT_INVALID",
    );

    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: Object.assign(
          Object.create(null),
          fixture.input,
        ) as ImportDayflowEvidenceBundleInput,
      }),
      "INPUT_INVALID",
    );
    class NonPlainEntry {
      relativePath = fixture.input.entries[0]!.relativePath;
      entryKind = "regular-file" as const;
      byteLength = fixture.input.entries[0]!.byteLength;
      bytes = fixture.input.entries[0]!.bytes;
    }
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [new NonPlainEntry(), fixture.input.entries[1]!],
        },
      }),
      "INPUT_INVALID",
    );
  });

  it("rejects large enumerable object extras and bounded array extras", () => {
    const fixture = buildFixture();
    const largeExtraObject = captureInput(fixture) as unknown as Record<
      string,
      unknown
    >;
    for (let index = 0; index < 10_000; index += 1) {
      largeExtraObject[`unexpected${index}`] = index;
    }
    expectSnapshotIssue(largeExtraObject, "INPUT_INVALID");

    let extraGetterCalls = 0;
    const emptyEntries: unknown[] = [];
    Object.defineProperty(emptyEntries, "unexpected", {
      enumerable: true,
      get() {
        extraGetterCalls += 1;
        throw new Error("enumerable array extra must not be read");
      },
    });
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries:
            emptyEntries as unknown as ImportDayflowEvidenceBundleInput["entries"],
        },
      }),
      "INPUT_INVALID",
    );

    const shortEntries = [fixture.input.entries[0]!];
    Object.defineProperty(shortEntries, "unexpected", {
      enumerable: true,
      get() {
        extraGetterCalls += 1;
        throw new Error("enumerable short-array extra must not be read");
      },
    });
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: { ...fixture.input, entries: shortEntries },
      }),
      "INPUT_INVALID",
    );
    expect(extraGetterCalls).toBe(0);
  });

  it("ignores non-enumerable and symbol extras without retaining them", () => {
    const fixture = buildFixture();
    const originalBundle = cloneBundle(fixture.input);
    const expectedImportedBundleDescriptor = { ...fixture.expected };
    const ignoredSymbol = Symbol("ignored snapshot metadata");
    let ignoredGetterCalls = 0;
    const captureCandidate = {
      candidateBytes: new Uint8Array(CANDIDATE_BYTES),
      originalBundle,
      expectedImportedBundleDescriptor,
    };
    const projectedTargets: object[] = [
      captureCandidate,
      originalBundle,
      originalBundle.entries,
      originalBundle.entries[0]!,
      expectedImportedBundleDescriptor,
    ];
    for (const target of projectedTargets) {
      Object.defineProperty(target, "ignoredNonEnumerable", {
        configurable: true,
        enumerable: false,
        get() {
          ignoredGetterCalls += 1;
          throw new Error("ignored getter must not run");
        },
      });
      Object.defineProperty(target, ignoredSymbol, {
        configurable: true,
        enumerable: true,
        value: "ignored-symbol-value",
      });
    }

    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureCandidate,
      );
    const freshBundle =
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      );
    const freshDescriptor =
      reverifyOwnedPreprocessedEvidenceVerificationSnapshotV0_1(snapshot);

    expect(ignoredGetterCalls).toBe(0);
    for (const projected of [
      snapshot,
      freshBundle,
      freshBundle.entries,
      freshBundle.entries[0]!,
      freshDescriptor,
    ]) {
      expect(
        Object.getOwnPropertyDescriptor(
          projected,
          "ignoredNonEnumerable",
        ),
      ).toBeUndefined();
      expect(Object.getOwnPropertySymbols(projected)).toEqual([]);
    }
  });

  it("rejects object and byte-view proxies without leaking trap failures", () => {
    const fixture = buildFixture();
    let objectTrapCalls = 0;
    const rootProxy = new Proxy(captureInput(fixture), {
      getPrototypeOf() {
        objectTrapCalls += 1;
        throw new Error("private proxy failure");
      },
      ownKeys() {
        objectTrapCalls += 1;
        throw new Error("private ownKeys failure");
      },
      getOwnPropertyDescriptor() {
        objectTrapCalls += 1;
        throw new Error("private descriptor failure");
      },
      get() {
        objectTrapCalls += 1;
        throw new Error("private value failure");
      },
    });
    expectSnapshotIssue(rootProxy, "INPUT_INVALID");
    expect(objectTrapCalls).toBe(0);

    let byteTrapCalls = 0;
    const byteProxy = new Proxy(CANDIDATE_BYTES, {
      get() {
        byteTrapCalls += 1;
        throw new Error("private byte proxy failure");
      },
    });
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: byteProxy,
      }),
      "INPUT_INVALID",
    );
    expect(byteTrapCalls).toBe(0);
  });

  it("rejects importer-near-miss and lexically unsafe paths before copying", () => {
    const fixture = buildFixture();
    const nearMissBytes = new Uint8Array(
      DAYFLOW_E2_IO_LIMITS.manifestBytes + 1,
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [
            {
              relativePath: "manifest.jsonx",
              entryKind: "regular-file",
              byteLength: nearMissBytes.byteLength,
              bytes: nearMissBytes,
            },
            fixture.input.entries[1]!,
          ],
        },
      }),
      "INPUT_INVALID",
    );

    let hostileHookCalls = 0;
    class PreflightTrapUint8Array extends Uint8Array {
      override get buffer(): ArrayBuffer {
        hostileHookCalls += 1;
        throw new Error("buffer hook");
      }

      override get byteLength(): number {
        hostileHookCalls += 1;
        throw new Error("byteLength hook");
      }

      override get byteOffset(): number {
        hostileHookCalls += 1;
        throw new Error("byteOffset hook");
      }

      override [Symbol.iterator](): ArrayIterator<number> {
        hostileHookCalls += 1;
        throw new Error("iterator hook");
      }
    }
    const hostileBytes = new PreflightTrapUint8Array(1);
    Object.defineProperty(hostileBytes, "constructor", {
      get() {
        hostileHookCalls += 1;
        throw new Error("constructor hook");
      },
    });
    const validHash = "a".repeat(64);
    const invalidPaths = [
      "",
      "/manifest.json",
      "objects\\sha256\\" + validHash + ".jpg",
      "objects/sha256/" + validHash + ".jpg\u0000",
      "objects/sha256/" + validHash + ".jpg\u001f",
      "objects//sha256/" + validHash + ".jpg",
      "objects/./sha256/" + validHash + ".jpg",
      "objects/../sha256/" + validHash + ".jpg",
      "objects/sha256/short.jpg",
      "objects/sha256/" + "A".repeat(64) + ".jpg",
      "objects/sha256/" + validHash + ".JPG",
      "objects/sha256/%2e%2e.jpg",
      "x".repeat(DAYFLOW_E2_IO_LIMITS.relativePathCharacters + 1),
    ];
    for (const relativePath of invalidPaths) {
      expectSnapshotIssue(
        captureInput(fixture, {
          originalBundle: {
            ...fixture.input,
            entries: [
              {
                relativePath,
                entryKind: "regular-file",
                byteLength: 1,
                bytes: hostileBytes,
              },
              fixture.input.entries[1]!,
            ],
          },
        }),
        "INPUT_INVALID",
      );
      expect(hostileHookCalls).toBe(0);
    }
  });

  it("rejects invalid bundle IDs and duplicate control or object paths", () => {
    const fixture = buildFixture();
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: { ...fixture.input, bundleId: "" },
      }),
      "INPUT_INVALID",
    );

    const manifest = fixture.input.entries[0]!;
    const completion = fixture.input.entries[1]!;
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [manifest, { ...manifest }, completion],
        },
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [manifest, completion, { ...completion }],
        },
      }),
      "INPUT_INVALID",
    );

    const tinyBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const object = objectEntry(0, tinyBytes);
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [manifest, object, { ...object }, completion],
        },
      }),
      "INPUT_INVALID",
    );
  });

  it("rejects missing control entries after preflighting maximum object counts", () => {
    const fixture = buildFixture();
    const tenMiB = new Uint8Array(DAYFLOW_E2_IO_LIMITS.objectBytes);
    const objects = Array.from({ length: 256 }, (_, index) =>
      objectEntry(index, tenMiB),
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [...objects, fixture.input.entries[1]!],
        },
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [fixture.input.entries[0]!, ...objects],
        },
      }),
      "INPUT_INVALID",
    );

    const oversizedObject = new Uint8Array(
      DAYFLOW_E2_IO_LIMITS.objectBytes + 1,
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [objectEntry(300, oversizedObject), fixture.input.entries[1]!],
        },
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: new Uint8Array(
          DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.candidateBytes +
            1,
        ),
        originalBundle: {
          ...fixture.input,
          entries: [fixture.input.entries[1]!],
        },
      }),
      "INPUT_INVALID",
    );

    const sixMiBPlusOne = new Uint8Array(6 * 1024 * 1024 + 1);
    const aggregateOverflow = [
      ...Array.from({ length: 25 }, (_, index) =>
        objectEntry(index + 400, tenMiB),
      ),
      objectEntry(425, sixMiBPlusOne),
    ];
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [fixture.input.entries[0]!, ...aggregateOverflow],
        },
      }),
      "INPUT_INVALID",
    );
  });

  it("accepts the 256-object and 258-entry preflight boundary", () => {
    const fixture = buildFixture();
    const tinyBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const boundaryEntries = [
      fixture.input.entries[0]!,
      ...Array.from({ length: 256 }, (_, index) =>
        objectEntry(index, tinyBytes),
      ),
      fixture.input.entries[1]!,
    ];
    expect(boundaryEntries).toHaveLength(
      DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.entryCount,
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: { ...fixture.input, entries: boundaryEntries },
      }),
      "BUNDLE_IMPORT_REJECTED",
    );
  });

  it("ignores hostile Uint8Array subclass hooks and copies exact view ranges", () => {
    const fixture = buildFixture();
    let hookCalls = 0;
    class HostileUint8Array extends Uint8Array {
      override get buffer(): ArrayBuffer {
        hookCalls += 1;
        throw new Error("buffer hook");
      }

      override get byteLength(): number {
        hookCalls += 1;
        throw new Error("byteLength hook");
      }

      override get byteOffset(): number {
        hookCalls += 1;
        throw new Error("byteOffset hook");
      }

      static get [Symbol.species](): Uint8ArrayConstructor {
        hookCalls += 1;
        throw new Error("species hook");
      }

      override [Symbol.iterator](): ArrayIterator<number> {
        hookCalls += 1;
        throw new Error("iterator hook");
      }
    }

    function hostileView(source: Uint8Array): Uint8Array {
      const backing = new ArrayBuffer(source.length + 8);
      new Uint8Array(backing).fill(0xa5);
      new Uint8Array(backing, 4, source.length).set(source);
      const view = new HostileUint8Array(backing, 4, source.length);
      Object.defineProperty(view, "constructor", {
        get() {
          hookCalls += 1;
          throw new Error("constructor hook");
        },
      });
      return view;
    }

    const candidate = hostileView(CANDIDATE_BYTES);
    const manifest = fixture.input.entries[0]!;
    const hostileManifest = hostileView(manifest.bytes);
    const snapshot =
      captureOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        captureInput(fixture, {
          candidateBytes: candidate,
          originalBundle: replaceEntryBytes(
            fixture.input,
            0,
            hostileManifest,
            manifest.byteLength,
          ),
        }),
      );

    expect(hookCalls).toBe(0);
    expect(
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      ),
    ).toEqual(CANDIDATE_BYTES);
    expect(
      copyOriginalBundleInputFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        snapshot,
      ).entries[0]!.bytes,
    ).toEqual(manifest.bytes);
    expect(hookCalls).toBe(0);
  });

  it("rejects detached and shared candidate and entry byte views", () => {
    const fixture = buildFixture();
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: makeDetachedBytes(CANDIDATE_BYTES),
      }),
      "INPUT_INVALID",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: replaceEntryBytes(
          fixture.input,
          0,
          makeDetachedBytes(fixture.input.entries[0]!.bytes),
          fixture.input.entries[0]!.byteLength,
        ),
      }),
      "INPUT_INVALID",
    );

    if (typeof SharedArrayBuffer !== "undefined") {
      const sharedCandidate = new Uint8Array(
        new SharedArrayBuffer(CANDIDATE_BYTES.byteLength),
      );
      sharedCandidate.set(CANDIDATE_BYTES);
      expectSnapshotIssue(
        captureInput(fixture, { candidateBytes: sharedCandidate }),
        "INPUT_INVALID",
      );

      const manifest = fixture.input.entries[0]!;
      const sharedManifest = new Uint8Array(
        new SharedArrayBuffer(manifest.byteLength),
      );
      sharedManifest.set(manifest.bytes);
      expectSnapshotIssue(
        captureInput(fixture, {
          originalBundle: replaceEntryBytes(
            fixture.input,
            0,
            sharedManifest,
            manifest.byteLength,
          ),
        }),
        "INPUT_INVALID",
      );
    }
  });

  it("rejects resizable and growable candidate and entry byte views when supported", () => {
    const fixture = buildFixture();
    const resizableGetter = Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "resizable",
    )?.get;
    if (resizableGetter !== undefined) {
      const ResizableArrayBuffer = ArrayBuffer as unknown as new (
        byteLength: number,
        options: { maxByteLength: number },
      ) => ArrayBuffer;
      const candidateBuffer = new ResizableArrayBuffer(
        CANDIDATE_BYTES.byteLength,
        { maxByteLength: CANDIDATE_BYTES.byteLength + 8 },
      );
      if (Reflect.apply(resizableGetter, candidateBuffer, []) === true) {
        const resizableCandidate = new Uint8Array(candidateBuffer);
        resizableCandidate.set(CANDIDATE_BYTES);
        expectSnapshotIssue(
          captureInput(fixture, { candidateBytes: resizableCandidate }),
          "INPUT_INVALID",
        );

        const manifest = fixture.input.entries[0]!;
        const manifestBuffer = new ResizableArrayBuffer(
          manifest.byteLength,
          { maxByteLength: manifest.byteLength + 8 },
        );
        const resizableManifest = new Uint8Array(manifestBuffer);
        resizableManifest.set(manifest.bytes);
        expectSnapshotIssue(
          captureInput(fixture, {
            originalBundle: replaceEntryBytes(
              fixture.input,
              0,
              resizableManifest,
              manifest.byteLength,
            ),
          }),
          "INPUT_INVALID",
        );
      }
    }

    const growableGetter =
      typeof SharedArrayBuffer === "undefined"
        ? undefined
        : Object.getOwnPropertyDescriptor(
            SharedArrayBuffer.prototype,
            "growable",
          )?.get;
    if (growableGetter !== undefined) {
      const GrowableSharedArrayBuffer =
        SharedArrayBuffer as unknown as new (
          byteLength: number,
          options: { maxByteLength: number },
        ) => SharedArrayBuffer;
      const candidateBuffer = new GrowableSharedArrayBuffer(
        CANDIDATE_BYTES.byteLength,
        { maxByteLength: CANDIDATE_BYTES.byteLength + 8 },
      );
      if (Reflect.apply(growableGetter, candidateBuffer, []) === true) {
        const growableCandidate = new Uint8Array(candidateBuffer);
        growableCandidate.set(CANDIDATE_BYTES);
        expectSnapshotIssue(
          captureInput(fixture, { candidateBytes: growableCandidate }),
          "INPUT_INVALID",
        );

        const manifest = fixture.input.entries[0]!;
        const manifestBuffer = new GrowableSharedArrayBuffer(
          manifest.byteLength,
          { maxByteLength: manifest.byteLength + 8 },
        );
        const growableManifest = new Uint8Array(manifestBuffer);
        growableManifest.set(manifest.bytes);
        expectSnapshotIssue(
          captureInput(fixture, {
            originalBundle: replaceEntryBytes(
              fixture.input,
              0,
              growableManifest,
              manifest.byteLength,
            ),
          }),
          "INPUT_INVALID",
        );
      }
    }
  });

  it("preflights candidate and per-entry resource limits before copying", () => {
    const fixture = buildFixture();
    expectSnapshotIssue(
      captureInput(fixture, {
        candidateBytes: new Uint8Array(
          DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.candidateBytes +
            1,
        ),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: replaceEntryBytes(
          fixture.input,
          0,
          new Uint8Array(DAYFLOW_E2_IO_LIMITS.manifestBytes + 1),
        ),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: replaceEntryBytes(
          fixture.input,
          1,
          new Uint8Array(DAYFLOW_E2_IO_LIMITS.completionMarkerBytes + 1),
        ),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    const oversizedObject = new Uint8Array(
      DAYFLOW_E2_IO_LIMITS.objectBytes + 1,
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [
            fixture.input.entries[0]!,
            objectEntry(1, oversizedObject),
            fixture.input.entries[1]!,
          ],
        },
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: replaceEntryBytes(
          fixture.input,
          0,
          fixture.input.entries[0]!.bytes,
          fixture.input.entries[0]!.byteLength + 1,
        ),
      }),
      "INPUT_INVALID",
    );
  });

  it("preflights entry count, missing-control precedence, and object aggregate bounds", () => {
    const fixture = buildFixture();
    const tinyBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const tenMiB = new Uint8Array(DAYFLOW_E2_IO_LIMITS.objectBytes);
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [
            fixture.input.entries[0]!,
            ...Array.from({ length: 26 }, (_, index) =>
              objectEntry(index, tenMiB),
            ),
            fixture.input.entries[1]!,
          ],
        },
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: Array.from({ length: 257 }, (_, index) =>
            objectEntry(index, tinyBytes),
          ),
        },
      }),
      "INPUT_INVALID",
    );

    const sixMiBPlusOne = new Uint8Array(6 * 1024 * 1024 + 1);
    const aggregateEntries = [
      ...Array.from({ length: 25 }, (_, index) =>
        objectEntry(index, tenMiB),
      ),
      objectEntry(25, sixMiBPlusOne),
    ];
    expectSnapshotIssue(
      captureInput(fixture, {
        originalBundle: {
          ...fixture.input,
          entries: [
            fixture.input.entries[0]!,
            ...aggregateEntries,
            fixture.input.entries[1]!,
          ],
        },
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    expect(
      DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS.totalEntryBytes,
    ).toBe(
      DAYFLOW_E2_IO_LIMITS.manifestBytes +
        DAYFLOW_E2_IO_LIMITS.completionMarkerBytes +
        DAYFLOW_E2_IO_LIMITS.bundleObjectBytes,
    );
  });

  it("rejects forged handles without exposing snapshot state", () => {
    expect(() =>
      copyCandidateBytesFromOwnedPreprocessedEvidenceVerificationSnapshotV0_1(
        Object.freeze({}) as never,
      ),
    ).toThrowError(
      expect.objectContaining({ issueCode: "SNAPSHOT_HANDLE_INVALID" }),
    );
  });
});
