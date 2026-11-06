import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  dayflowExportManifestSha256,
  dayflowScreenEvidenceExportSchema,
  jcsCanonicalize,
  type DayflowScreenEvidenceExport,
} from "../src/dayflowEvidence/contracts";
import * as importerApi from "../src/evaluation/dayflowAblation/importEvidenceBundle";
import {
  DAYFLOW_E2_IO_LIMITS,
  DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_HASH_DOMAIN,
  DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_SCHEMA_VERSION,
  DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
  DayflowEvidenceBundleImportError,
  importDayflowEvidenceBundle,
  importDayflowEvidenceBundleForResolutionV0_1,
  sealDayflowEvidenceBundleCompletion,
  type DayflowEvidenceBundleCompletion,
  type DayflowEvidenceBundleCompletionPreimage,
  type DayflowEvidenceBundleImportIssueCode,
  type ImportDayflowEvidenceBundleInput,
} from "../src/evaluation/dayflowAblation/importEvidenceBundle";
import * as strictJsonApi from "../src/evaluation/dayflowAblation/strictDuplicateAwareJson";

const ZERO_HASH = "0".repeat(64);
const ONE_HASH = "1".repeat(64);
const TWO_HASH = "2".repeat(64);
const START = "2026-08-17T00:00:00.000Z";
const END = "2026-08-17T00:00:01.000Z";
const COMPLETED = "2026-08-17T00:00:02.000Z";
const BUNDLE_ID = "synthetic-e2io-bundle-1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SYNTHETIC_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x53, 0x59, 0x4e, 0x54, 0x48, 0x45,
  0x54, 0x49, 0x43, 0xff, 0xd9,
]);
const SECOND_SYNTHETIC_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x53, 0x45, 0x43, 0x4f, 0x4e, 0x44,
  0xff, 0xd9,
]);

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(`${jcsCanonicalize(value)}\n`);
}

function concatenate(...values: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((total, value) => total + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function attestation(pseudonymousSubjectId: string) {
  return {
    attestationSchemaVersion:
      "dayflow-pseudonymous-capture-attestation-v0.1" as const,
    pseudonymousSubjectId,
    policyVersion: "capture-v0.1",
    policySha256: ZERO_HASH,
    attestedAt: START,
  };
}

function exportFixture(
  options: Readonly<{ empty?: boolean; bytes?: Uint8Array }> = {},
): DayflowScreenEvidenceExport {
  const empty = options.empty ?? false;
  const bytes = options.bytes ?? SYNTHETIC_JPEG_BYTES;
  const sha256 = rawSha256(bytes);
  const withoutHash = {
    contract: "dayflow-screen-evidence-export-v0.1" as const,
    schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
    exportId: "synthetic-e2io-export-1",
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
      fixtureSetId: "synthetic-e2io-fixture-set-1",
      fixtureGeneratorVersion: "synthetic-e2io-generator-v0.1",
      fixtureGeneratorSeed: "synthetic-e2io-seed-1",
      fixtureGeneratorConfigSha256: TWO_HASH,
    },
    consentRevision: "synthetic-consent-v0.1",
    retentionPolicyId: "synthetic-retention-v0.1",
    coverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: empty ? ("paused" as const) : ("running" as const),
          expectedFrameCount: empty ? 0 : 1,
          observedFrameCount: empty ? 0 : 1,
          rejectedFrameCount: 0,
        },
      ],
      expectedFrameCount: empty ? 0 : 1,
      observedFrameCount: empty ? 0 : 1,
      rejectedFrameCount: 0,
    },
    artifacts: empty
      ? []
      : [
          {
            sourceArtifactId: "synthetic-e2io-artifact-1",
            sourceRowId: "1",
            capturedAt: START,
            sequenceWithinSecond: "0",
            idleSeconds: 0,
            relativeBlobRef: `objects/sha256/${sha256}.jpg`,
            mimeType: "image/jpeg" as const,
            byteSize: String(bytes.byteLength),
            sha256,
            privacyState: "synthetic_fixture" as const,
            captureConsentRevision: "synthetic-consent-v0.1",
            capturePolicyVersion: "capture-v0.1",
            capturePolicyDecision: "allow" as const,
            pseudonymousDisplayAttestation: attestation(
              "synthetic-display-e2io",
            ),
            pseudonymousWindowAttestation: attestation(
              "synthetic-window-e2io",
            ),
            placeholderState: "synthetic_fixture" as const,
            availability: "available" as const,
          },
        ],
  };
  return dayflowScreenEvidenceExportSchema.parse({
    ...withoutHash,
    detachedManifestSha256: dayflowExportManifestSha256(withoutHash),
  });
}

type ImportFixture = Readonly<{
  input: ImportDayflowEvidenceBundleInput;
  manifest: DayflowScreenEvidenceExport;
  completion: DayflowEvidenceBundleCompletion;
  manifestBytes: Uint8Array;
  completionBytes: Uint8Array;
  objectBytes: readonly Uint8Array[];
}>;

function inputFromManifest(
  manifest: DayflowScreenEvidenceExport,
  objectBytes: Uint8Array | readonly Uint8Array[],
): ImportFixture {
  const objectByteValues =
    objectBytes instanceof Uint8Array
      ? manifest.artifacts.map(() => objectBytes)
      : [...objectBytes];
  if (objectByteValues.length !== manifest.artifacts.length) {
    throw new TypeError("Artifact byte fixture count mismatch");
  }
  const manifestBytes = canonicalBytes(manifest);
  const totalObjectBytes = manifest.artifacts.reduce(
    (total, artifact) => total + Number(artifact.byteSize),
    0,
  );
  const completion = sealDayflowEvidenceBundleCompletion({
    completionSchemaVersion:
      DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_SCHEMA_VERSION,
    bundleId: BUNDLE_ID,
    exportId: manifest.exportId,
    manifestRelativePath: "manifest.json",
    manifestByteLength: manifestBytes.byteLength,
    manifestRawSha256: rawSha256(manifestBytes),
    manifestDetachedSha256: manifest.detachedManifestSha256,
    objectCount: manifest.artifacts.length,
    totalObjectBytes,
    completedAt: COMPLETED,
  });
  const completionBytes = canonicalBytes(completion);
  const objectEntries = manifest.artifacts
    .map((artifact, index) => {
      const bytes = objectByteValues[index]!;
      return {
        relativePath: artifact.relativeBlobRef,
        entryKind: "regular-file" as const,
        byteLength: bytes.byteLength,
        bytes: new Uint8Array(bytes),
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    input: {
      mode: "synthetic-contract-conformance",
      bundleId: BUNDLE_ID,
      entries: [
        {
          relativePath: "manifest.json",
          entryKind: "regular-file",
          byteLength: manifestBytes.byteLength,
          bytes: manifestBytes,
        },
        ...objectEntries,
        {
          relativePath: "COMPLETE",
          entryKind: "regular-file",
          byteLength: completionBytes.byteLength,
          bytes: completionBytes,
        },
      ],
    },
    manifest,
    completion,
    manifestBytes,
    completionBytes,
    objectBytes: objectByteValues,
  };
}

function buildFixture(options: Readonly<{ empty?: boolean }> = {}): ImportFixture {
  const manifest = exportFixture({ empty: options.empty });
  return inputFromManifest(manifest, SYNTHETIC_JPEG_BYTES);
}

function resealManifest(
  manifest: DayflowScreenEvidenceExport,
  changes: Partial<
    Omit<DayflowScreenEvidenceExport, "detachedManifestSha256">
  >,
): DayflowScreenEvidenceExport {
  const { detachedManifestSha256: _ignored, ...preimage } = manifest;
  const changed = { ...preimage, ...changes };
  return {
    ...changed,
    detachedManifestSha256: dayflowExportManifestSha256(changed),
  };
}

function buildTwoObjectFixture(): ImportFixture {
  const manifest = exportFixture();
  const first = manifest.artifacts[0]!;
  const secondSha256 = rawSha256(SECOND_SYNTHETIC_JPEG_BYTES);
  const interval = manifest.coverage.intervals[0]!;
  const changed = resealManifest(manifest, {
    coverage: {
      intervals: [
        {
          ...interval,
          expectedFrameCount: 2,
          observedFrameCount: 2,
        },
      ],
      expectedFrameCount: 2,
      observedFrameCount: 2,
      rejectedFrameCount: 0,
    },
    artifacts: [
      first,
      {
        ...first,
        sourceArtifactId: "synthetic-e2io-artifact-2",
        sourceRowId: "2",
        sequenceWithinSecond: "1",
        relativeBlobRef:
          "objects/sha256/" + secondSha256 + ".jpg",
        byteSize: String(SECOND_SYNTHETIC_JPEG_BYTES.byteLength),
        sha256: secondSha256,
      },
    ],
  });
  return inputFromManifest(changed, [
    SYNTHETIC_JPEG_BYTES,
    SECOND_SYNTHETIC_JPEG_BYTES,
  ]);
}

function cloneInput(
  input: ImportDayflowEvidenceBundleInput,
): ImportDayflowEvidenceBundleInput {
  return {
    mode: input.mode,
    bundleId: input.bundleId,
    entries: input.entries.map((entry) => ({
      ...entry,
      bytes: new Uint8Array(entry.bytes),
    })),
  };
}

function replaceEntryBytes(
  input: ImportDayflowEvidenceBundleInput,
  relativePath: string,
  bytes: Uint8Array,
): ImportDayflowEvidenceBundleInput {
  return {
    ...input,
    entries: input.entries.map((entry) =>
      entry.relativePath === relativePath
        ? { ...entry, byteLength: bytes.byteLength, bytes }
        : entry,
    ),
  };
}

function resealCompletion(
  completion: DayflowEvidenceBundleCompletion,
  changes: Partial<DayflowEvidenceBundleCompletionPreimage>,
): DayflowEvidenceBundleCompletion {
  const { completionSha256: _ignored, ...preimage } = completion;
  return sealDayflowEvidenceBundleCompletion({ ...preimage, ...changes });
}

function withCompletion(
  fixture: ImportFixture,
  completion: DayflowEvidenceBundleCompletion,
): ImportDayflowEvidenceBundleInput {
  return replaceEntryBytes(
    fixture.input,
    "COMPLETE",
    canonicalBytes(completion),
  );
}

function expectIssue(
  candidate: unknown,
  issueCode: DayflowEvidenceBundleImportIssueCode,
): void {
  try {
    importDayflowEvidenceBundle(
      candidate as ImportDayflowEvidenceBundleInput,
    );
    throw new TypeError("Expected bundle import to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DayflowEvidenceBundleImportError);
    if (!(error instanceof DayflowEvidenceBundleImportError)) throw error;
    expect(error.issueCode).toBe(issueCode);
    expect(error.message).toBe(
      `Dayflow evidence bundle import failed (${issueCode})`,
    );
  }
}

function expectResolutionIssue(
  candidate: ImportDayflowEvidenceBundleInput,
  issueCode: DayflowEvidenceBundleImportIssueCode,
): void {
  try {
    importDayflowEvidenceBundleForResolutionV0_1(candidate);
    throw new TypeError("Expected resolved bundle import to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DayflowEvidenceBundleImportError);
    if (!(error instanceof DayflowEvidenceBundleImportError)) throw error;
    expect(error.issueCode).toBe(issueCode);
    expect(error.message).toBe(
      `Dayflow evidence bundle import failed (${issueCode})`,
    );
  }
}

describe("Dayflow E2-IO completed evidence bundle import", () => {
  it("imports observed and valid-empty synthetic bundles deterministically", () => {
    const fixture = buildFixture();
    const first = importDayflowEvidenceBundle(fixture.input);
    const second = importDayflowEvidenceBundle(fixture.input);

    expect(second).toEqual(first);
    expect(first).toEqual({
      importSchemaVersion: DAYFLOW_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
      manifestRawSha256: rawSha256(fixture.manifestBytes),
      manifestDetachedSha256: fixture.manifest.detachedManifestSha256,
      completionSha256: fixture.completion.completionSha256,
      objectCount: 1,
      totalObjectBytes: SYNTHETIC_JPEG_BYTES.byteLength,
      replayIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Object.keys(first).sort()).toEqual(
      [
        "completionSha256",
        "importSchemaVersion",
        "manifestDetachedSha256",
        "manifestRawSha256",
        "objectCount",
        "replayIdentitySha256",
        "totalObjectBytes",
      ].sort(),
    );

    const empty = importDayflowEvidenceBundle(buildFixture({ empty: true }).input);
    expect(empty.objectCount).toBe(0);
    expect(empty.totalObjectBytes).toBe(0);
  });

  it("returns one frozen minimal resolved manifest from the same import pass", () => {
    const fixture = buildTwoObjectFixture();
    const input = cloneInput(fixture.input);
    const publicDescriptor = importDayflowEvidenceBundle(fixture.input);
    const imported = importDayflowEvidenceBundleForResolutionV0_1(input);
    const resolved = imported.resolvedManifest;

    expect(Object.keys(imported).sort()).toEqual([
      "descriptor",
      "resolvedManifest",
    ]);
    expect(imported.descriptor).toEqual(publicDescriptor);
    expect(Object.keys(imported.descriptor).sort()).toEqual(
      [
        "completionSha256",
        "importSchemaVersion",
        "manifestDetachedSha256",
        "manifestRawSha256",
        "objectCount",
        "replayIdentitySha256",
        "totalObjectBytes",
      ].sort(),
    );
    expect(Object.keys(resolved).sort()).toEqual(
      [
        "artifacts",
        "coverage",
        "dataOrigin",
        "detachedManifestSha256",
        "exportId",
        "manifestRawSha256",
        "schemaVersion",
        "studyPhase",
        "studyProtocolHash",
        "windowEnd",
        "windowStart",
      ].sort(),
    );
    expect(resolved).toMatchObject({
      manifestRawSha256: rawSha256(fixture.manifestBytes),
      schemaVersion: fixture.manifest.schemaVersion,
      exportId: fixture.manifest.exportId,
      detachedManifestSha256: fixture.manifest.detachedManifestSha256,
      dataOrigin: "synthetic",
      studyPhase: "contract_conformance",
      studyProtocolHash: fixture.manifest.studyProtocolHash,
      windowStart: fixture.manifest.windowStart,
      windowEnd: fixture.manifest.windowEnd,
      coverage: fixture.manifest.coverage,
      artifacts: fixture.manifest.artifacts.map((artifact) => ({
        sourceRowId: artifact.sourceRowId,
        capturedAt: artifact.capturedAt,
        sha256: artifact.sha256,
      })),
    });
    expect(Object.keys(resolved.coverage).sort()).toEqual(
      [
        "expectedFrameCount",
        "intervals",
        "observedFrameCount",
        "rejectedFrameCount",
      ].sort(),
    );
    for (const interval of resolved.coverage.intervals) {
      expect(Object.keys(interval).sort()).toEqual(
        [
          "end",
          "expectedFrameCount",
          "observedFrameCount",
          "reason",
          "rejectedFrameCount",
          "start",
        ].sort(),
      );
      expect(Object.isFrozen(interval)).toBe(true);
    }
    for (const artifact of resolved.artifacts) {
      expect(Object.keys(artifact).sort()).toEqual([
        "capturedAt",
        "sha256",
        "sourceRowId",
      ]);
      expect(Object.isFrozen(artifact)).toBe(true);
    }

    const serialized = JSON.stringify(resolved);
    for (const excludedKey of [
      "bytes",
      "relativePath",
      "relativeBlobRef",
      "sourceArtifactId",
      "databaseSnapshotIdentity",
      "dayflowCommitSha",
      "sourceFileHashes",
      "packageResolvedSha256",
      "captureConfig",
      "capturePolicyVersion",
      "consentRevision",
      "retentionPolicyId",
      "pseudonymousDisplayAttestation",
      "pseudonymousWindowAttestation",
      "title",
      "summary",
      "semanticOutput",
      "suggestion",
    ]) {
      expect(serialized).not.toContain(`"${excludedKey}"`);
    }
    expect(serialized).not.toContain("objects/sha256/");
    expect(serialized).not.toContain("Sources/ScreenRecorder.swift");

    expect(Object.isFrozen(imported)).toBe(true);
    expect(Object.isFrozen(imported.descriptor)).toBe(true);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.coverage)).toBe(true);
    expect(Object.isFrozen(resolved.coverage.intervals)).toBe(true);
    expect(Object.isFrozen(resolved.artifacts)).toBe(true);

    const projectionBeforeCallerMutation = JSON.stringify(resolved);
    for (const entry of input.entries) entry.bytes.fill(0);
    expect(JSON.stringify(resolved)).toBe(projectionBeforeCallerMutation);
  });

  it("returns the same closed errors through the resolved import seam", () => {
    const fixture = buildFixture();
    const artifact = fixture.manifest.artifacts[0]!;
    const invalidManifest = inputFromManifest(
      resealManifest(fixture.manifest, {
        artifacts: [{ ...artifact, idleSeconds: 1 }],
      }),
      SYNTHETIC_JPEG_BYTES,
    ).input;

    const tamperedBytes = new Uint8Array(SYNTHETIC_JPEG_BYTES);
    tamperedBytes[8] ^= 0xff;
    const invalidBlob = replaceEntryBytes(
      fixture.input,
      artifact.relativeBlobRef,
      tamperedBytes,
    );

    const invalidCompletion = withCompletion(fixture, {
      ...fixture.completion,
      completionSha256: ZERO_HASH,
    });

    for (const [candidate, issueCode] of [
      [invalidManifest, "MANIFEST_INVALID"],
      [invalidBlob, "BLOB_BYTES_MISMATCH"],
      [invalidCompletion, "COMPLETION_MARKER_INVALID"],
    ] as const) {
      expectIssue(candidate, issueCode);
      expectResolutionIssue(candidate, issueCode);
    }
  });

  it("returns an immutable descriptor isolated from caller byte mutation", () => {
    const fixture = buildFixture();
    const input = cloneInput(fixture.input);
    const imported = importDayflowEvidenceBundle(input);
    const snapshot = { ...imported };
    const objectEntry = input.entries[1]!;
    objectEntry.bytes[2] = objectEntry.bytes[2]! ^ 0xff;

    expect(imported).toEqual(snapshot);
    expect(Object.isFrozen(imported)).toBe(true);
    expect(Reflect.set(imported, "objectCount", 99)).toBe(false);
    expect(imported.objectCount).toBe(1);
    const fresh = importDayflowEvidenceBundle(buildFixture().input);
    expect(fresh).toEqual(snapshot);
  });

  it("rejects incomplete, non-regular, duplicate, extra, and unsafe entries", () => {
    const fixture = buildFixture();
    expectIssue(
      { ...fixture.input, entries: fixture.input.entries.slice(0, -1) },
      "BUNDLE_INCOMPLETE",
    );
    expectIssue(
      { ...fixture.input, entries: fixture.input.entries.slice(1) },
      "BUNDLE_INCOMPLETE",
    );

    const symlink = cloneInput(fixture.input);
    const symlinkEntries = symlink.entries.map((entry, index) =>
      index === 1 ? { ...entry, entryKind: "symlink" } : entry,
    );
    expectIssue({ ...symlink, entries: symlinkEntries }, "BUNDLE_INPUT_INVALID");

    for (const unsafePath of [
      "",
      "/private/frame.jpg",
      "../frame.jpg",
      "./frame.jpg",
      "objects//frame.jpg",
      "objects/../frame.jpg",
      "objects\\sha256\\frame.jpg",
      "objects/sha256/frame.jpg\u0000",
      "objects/sha256/frame.jpg\u001f",
      "objects/sha256/%2e%2e.jpg",
      "C:/private/frame.jpg",
      "file://private/frame.jpg",
      "objects/sha256/" + "A".repeat(64) + ".jpg",
    ]) {
      const unsafe = cloneInput(fixture.input);
      const unsafeEntries = unsafe.entries.map((entry, index) =>
        index === 1 ? { ...entry, relativePath: unsafePath } : entry,
      );
      expectIssue(
        { ...unsafe, entries: unsafeEntries },
        "BUNDLE_INPUT_INVALID",
      );
    }

    expectIssue(
      {
        ...fixture.input,
        entries: [
          fixture.input.entries[0]!,
          fixture.input.entries[1]!,
          fixture.input.entries[1]!,
          fixture.input.entries[2]!,
        ],
      },
      "ENTRY_SET_MISMATCH",
    );
    expectIssue(
      {
        ...fixture.input,
        entries: [
          fixture.input.entries[0]!,
          {
            relativePath: `objects/sha256/${ZERO_HASH}.jpg`,
            entryKind: "regular-file",
            byteLength: SYNTHETIC_JPEG_BYTES.byteLength,
            bytes: SYNTHETIC_JPEG_BYTES,
          },
          fixture.input.entries[1]!,
          fixture.input.entries[2]!,
        ],
      },
      "ENTRY_SET_MISMATCH",
    );
  });

  it("accepts caller reordering while deriving one canonical replay identity", () => {
    const fixture = buildTwoObjectFixture();
    const canonical = importDayflowEvidenceBundle(fixture.input);
    const reordered = {
      ...fixture.input,
      entries: [
        fixture.input.entries[2]!,
        fixture.input.entries[3]!,
        fixture.input.entries[0]!,
        fixture.input.entries[1]!,
      ],
    };
    expect(importDayflowEvidenceBundle(reordered)).toEqual(canonical);

    const changedFixture = inputFromManifest(
      exportFixture({ bytes: SECOND_SYNTHETIC_JPEG_BYTES }),
      SECOND_SYNTHETIC_JPEG_BYTES,
    );
    expect(
      importDayflowEvidenceBundle(changedFixture.input).replayIdentitySha256,
    ).not.toBe(canonical.replayIdentitySha256);
  });

  it("rejects noncanonical, duplicate-key, BOM, trailing, and invalid JSON", () => {
    const fixture = buildFixture();
    const noncanonicalManifest = encoder.encode(
      `${JSON.stringify(fixture.manifest, null, 2)}\n`,
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "manifest.json",
        noncanonicalManifest,
      ),
      "JSON_NOT_CANONICAL",
    );
    const manifestText = decoder.decode(fixture.manifestBytes);
    const duplicateManifest = encoder.encode(
      manifestText.replace(
        '{"artifacts":',
        '{"contract":"dayflow-screen-evidence-export-v0.1","contract":"dayflow-screen-evidence-export-v0.1","artifacts":',
      ),
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "manifest.json",
        duplicateManifest,
      ),
      "JSON_DUPLICATE_KEY",
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "manifest.json",
        concatenate(Uint8Array.from([0xef, 0xbb, 0xbf]), fixture.manifestBytes),
      ),
      "JSON_INVALID",
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "manifest.json",
        concatenate(fixture.manifestBytes, encoder.encode("{}\n")),
      ),
      "JSON_INVALID",
    );

    const duplicateCompletion = encoder.encode(
      decoder.decode(fixture.completionBytes).replace(
        '{"bundleId":',
        `{"bundleId":"${BUNDLE_ID}","bundleId":`,
      ),
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "COMPLETE",
        duplicateCompletion,
      ),
      "JSON_DUPLICATE_KEY",
    );
    expectIssue(
      replaceEntryBytes(fixture.input, "COMPLETE", Uint8Array.from([0x7b])),
      "JSON_INVALID",
    );
    const invalidUtf8 = Uint8Array.from([0xc3, 0x28]);
    expectIssue(
      replaceEntryBytes(fixture.input, "manifest.json", invalidUtf8),
      "JSON_INVALID",
    );
    expectIssue(
      replaceEntryBytes(fixture.input, "COMPLETE", invalidUtf8),
      "JSON_INVALID",
    );

    const nestedDuplicateManifest = encoder.encode(
      manifestText.replace(
        '"captureConfig":{',
        '"captureConfig":{"nested":{"a":1,"\\u0061":2},',
      ),
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "manifest.json",
        nestedDuplicateManifest,
      ),
      "JSON_DUPLICATE_KEY",
    );
    const nestedDuplicateCompletion = encoder.encode(
      decoder.decode(fixture.completionBytes).replace(
        '{"bundleId":',
        '{"nested":{"key":1,"\\u006bey":2},"bundleId":',
      ),
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "COMPLETE",
        nestedDuplicateCompletion,
      ),
      "JSON_DUPLICATE_KEY",
    );
  });

  it("rejects duplicate digest aliases and manifest MIME, idle, and filename mismatches", () => {
    const fixture = buildFixture();
    const artifact = fixture.manifest.artifacts[0]!;
    const interval = fixture.manifest.coverage.intervals[0]!;
    const duplicateAlias = resealManifest(fixture.manifest, {
      coverage: {
        intervals: [
          {
            ...interval,
            expectedFrameCount: 2,
            observedFrameCount: 2,
          },
        ],
        expectedFrameCount: 2,
        observedFrameCount: 2,
        rejectedFrameCount: 0,
      },
      artifacts: [
        artifact,
        {
          ...artifact,
          sourceArtifactId: "synthetic-e2io-artifact-alias",
          sourceRowId: "2",
          sequenceWithinSecond: "1",
        },
      ],
    });
    expectIssue(
      inputFromManifest(duplicateAlias, [
        SYNTHETIC_JPEG_BYTES,
        SYNTHETIC_JPEG_BYTES,
      ]).input,
      "ENTRY_SET_MISMATCH",
    );

    const nonzeroIdle = resealManifest(fixture.manifest, {
      artifacts: [{ ...artifact, idleSeconds: 1 }],
    });
    expectIssue(
      inputFromManifest(nonzeroIdle, SYNTHETIC_JPEG_BYTES).input,
      "MANIFEST_INVALID",
    );

    const wrongMime = resealManifest(fixture.manifest, {
      captureConfig: {
        ...fixture.manifest.captureConfig,
        allowedMimeTypes: ["image/png"],
      },
      artifacts: [{ ...artifact, mimeType: "image/png" }],
    });
    expectIssue(
      inputFromManifest(wrongMime, SYNTHETIC_JPEG_BYTES).input,
      "MANIFEST_INVALID",
    );

    const filenameMismatch = resealManifest(fixture.manifest, {
      artifacts: [
        {
          ...artifact,
          relativeBlobRef: "objects/sha256/" + ZERO_HASH + ".jpg",
        },
      ],
    });
    expectIssue(
      inputFromManifest(filenameMismatch, SYNTHETIC_JPEG_BYTES).input,
      "MANIFEST_INVALID",
    );
  });

  it("rejects completion self-hash and manifest binding substitutions", () => {
    const fixture = buildFixture();
    expect(DAYFLOW_EVIDENCE_BUNDLE_COMPLETION_HASH_DOMAIN).toBe(
      "blabase.dayflow-screen-evidence-bundle-completion.v0.1",
    );
    const badSelfHash = {
      ...fixture.completion,
      completionSha256: ZERO_HASH,
    };
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "COMPLETE",
        canonicalBytes(badSelfHash),
      ),
      "COMPLETION_MARKER_INVALID",
    );

    for (const changes of [
      { manifestRawSha256: ZERO_HASH },
      { manifestDetachedSha256: ZERO_HASH },
      { exportId: "synthetic-e2io-export-substituted" },
      { objectCount: 0 },
      { totalObjectBytes: 0 },
      { completedAt: START },
    ] satisfies readonly Partial<DayflowEvidenceBundleCompletionPreimage>[]) {
      expectIssue(
        withCompletion(
          fixture,
          resealCompletion(fixture.completion, changes),
        ),
        "MANIFEST_BINDING_MISMATCH",
      );
    }
  });

  it("rejects missing, substituted, tampered, and wrongly sized JPEG objects", () => {
    const fixture = buildFixture();
    expectIssue(
      {
        ...fixture.input,
        entries: [fixture.input.entries[0]!, fixture.input.entries[2]!],
      },
      "ENTRY_SET_MISMATCH",
    );

    const substituted = cloneInput(fixture.input);
    const substitutedEntries = substituted.entries.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            relativePath: `objects/sha256/${ZERO_HASH}.jpg`,
          }
        : entry,
    );
    expectIssue(
      { ...substituted, entries: substitutedEntries },
      "ENTRY_SET_MISMATCH",
    );

    const tampered = new Uint8Array(SYNTHETIC_JPEG_BYTES);
    tampered[8] ^= 0xff;
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        fixture.manifest.artifacts[0]!.relativeBlobRef,
        tampered,
      ),
      "BLOB_BYTES_MISMATCH",
    );

    const wrongSize = cloneInput(fixture.input);
    const wrongSizeEntries = wrongSize.entries.map((entry, index) =>
      index === 1 ? { ...entry, byteLength: entry.byteLength + 1 } : entry,
    );
    expectIssue(
      { ...wrongSize, entries: wrongSizeEntries },
      "BUNDLE_INPUT_INVALID",
    );

    const unframedBytes = Uint8Array.from([1, 2, 3, 4]);
    expectIssue(
      inputFromManifest(
        exportFixture({ bytes: unframedBytes }),
        unframedBytes,
      ).input,
      "BLOB_BYTES_MISMATCH",
    );
  });

  it("enforces manifest, marker, object, and strict input bounds", () => {
    const fixture = buildFixture();
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "manifest.json",
        new Uint8Array(DAYFLOW_E2_IO_LIMITS.manifestBytes + 1),
      ),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        "COMPLETE",
        new Uint8Array(DAYFLOW_E2_IO_LIMITS.completionMarkerBytes + 1),
      ),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectIssue(
      replaceEntryBytes(
        fixture.input,
        fixture.manifest.artifacts[0]!.relativeBlobRef,
        new Uint8Array(DAYFLOW_E2_IO_LIMITS.objectBytes + 1),
      ),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectIssue(
      { ...fixture.input, unexpectedRuntimePath: "/private" },
      "BUNDLE_INPUT_INVALID",
    );

    const tenMiB = new Uint8Array(DAYFLOW_E2_IO_LIMITS.objectBytes);
    const sixMiBPlusOne = new Uint8Array(6 * 1024 * 1024 + 1);
    const aggregateEntries = [
      ...Array.from({ length: 25 }, (_, index) => ({
        relativePath:
          "objects/sha256/" +
          (index + 10).toString(16).padStart(64, "0") +
          ".jpg",
        entryKind: "regular-file" as const,
        byteLength: tenMiB.byteLength,
        bytes: tenMiB,
      })),
      {
        relativePath: "objects/sha256/" + "f".repeat(64) + ".jpg",
        entryKind: "regular-file" as const,
        byteLength: sixMiBPlusOne.byteLength,
        bytes: sixMiBPlusOne,
      },
    ];
    expectIssue(
      {
        ...fixture.input,
        entries: [
          fixture.input.entries[0]!,
          ...aggregateEntries,
          fixture.input.entries.at(-1)!,
        ],
      },
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const sharedTinyBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const tooManyEntries = Array.from({ length: 257 }, (_, index) => ({
      relativePath:
        "objects/sha256/" +
        (index + 1000).toString(16).padStart(64, "0") +
        ".jpg",
      entryKind: "regular-file" as const,
      byteLength: sharedTinyBytes.byteLength,
      bytes: sharedTinyBytes,
    }));
    expectIssue(
      {
        ...fixture.input,
        entries: [
          fixture.input.entries[0]!,
          ...tooManyEntries,
          fixture.input.entries.at(-1)!,
        ],
      },
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("exposes only frozen hash/count transport data and a capability-free closure", () => {
    const imported = importDayflowEvidenceBundle(buildFixture().input);
    expect(Object.keys(imported).sort()).toEqual([
      "completionSha256",
      "importSchemaVersion",
      "manifestDetachedSha256",
      "manifestRawSha256",
      "objectCount",
      "replayIdentitySha256",
      "totalObjectBytes",
    ]);
    expect(Object.isFrozen(imported)).toBe(true);
    expect(JSON.stringify(imported)).not.toMatch(
      /bytes|path|idleSeconds|title|summary|applicationHint|bundleId|exportId/u,
    );
    expect(imported).not.toHaveProperty("verified");
    expect(imported).not.toHaveProperty("evidence");
    expect(imported).not.toHaveProperty("normalizedEvidence");
    expect(imported).not.toHaveProperty("state");
    expect(imported).not.toHaveProperty("asOf");
    expect(Object.keys(importerApi).join("\n")).not.toMatch(
      /normalize|render|publish|live|provider|buildDataset/u,
    );
    expect(Object.keys(strictJsonApi).sort()).toEqual([
      "StrictDuplicateAwareJsonParseError",
      "parseStrictDuplicateAwareJson",
    ]);
    const capabilitySurface = [
      ...Object.values(importerApi),
      ...Object.values(strictJsonApi),
    ]
      .filter((value) => typeof value === "function")
      .map((value) => String(value))
      .join("\n");
    expect(capabilitySurface).not.toMatch(
      /buildDataset|node:fs|readFile|writeFile|fetch\(|process\.|Date\.now|Math\.random|\.local|runtime/u,
    );
  });
});
