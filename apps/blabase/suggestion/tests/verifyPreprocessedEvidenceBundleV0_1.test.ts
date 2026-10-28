import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  dayflowExportManifestSha256,
  domainSeparatedSha256,
  jcsCanonicalize,
  type DayflowScreenEvidenceExport,
} from "../src/dayflowEvidence/contracts";
import {
  DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
  DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION,
  sealDayflowPreprocessedEvidenceV0_1,
  serializeDayflowPreprocessedEvidenceV0_1,
  type DayflowPreprocessedEvidenceV0_1Preimage,
} from "../src/dayflowEvidence/preprocessedEvidenceV0_1";
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
  captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1,
  type OwnedPreprocessedEvidenceVerificationSnapshotV0_1,
} from "../src/evaluation/dayflowAblation/preprocessedEvidenceVerificationSnapshotV0_1";
import {
  verifyDayflowPreprocessedEvidenceV0_1,
  verifyPreprocessedEvidenceBundlePrerequisitesV0_1,
  verifyPreprocessedEvidenceBundleResolutionV0_1,
  type OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1,
  type DayflowPreprocessedEvidenceIssueCodeV0_1,
  type PreprocessedEvidenceBundlePrerequisiteIssueCodeV0_1,
  type PreprocessedEvidenceBundleResolutionIssueCodeV0_1,
} from "../src/evaluation/dayflowAblation/verifyPreprocessedEvidenceBundleV0_1";

const ZERO_HASH = "0".repeat(64);
const ONE_HASH = "1".repeat(64);
const TWO_HASH = "2".repeat(64);
const THREE_HASH = "3".repeat(64);
const START = "2026-08-20T00:00:00.000Z";
const END = "2026-08-20T00:00:01.000Z";
const COMPLETED = "2026-08-20T00:00:02.000Z";
const BUNDLE_ID = "synthetic-e2schema-stage8-bundle-1";
const encoder = new TextEncoder();
const SYNTHETIC_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x53, 0x59, 0x4e, 0x54, 0x48, 0x45,
  0x54, 0x49, 0x43, 0xff, 0xd9,
]);
const SECOND_SYNTHETIC_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x53, 0x45, 0x43, 0x4f, 0x4e, 0x44,
  0xff, 0xd9,
]);

type Fixture = Readonly<{
  input: ImportDayflowEvidenceBundleInput;
  descriptor: ImportedDayflowEvidenceBundle;
  manifest: DayflowScreenEvidenceExport;
  objectBytes: readonly Uint8Array[];
  preimage: DayflowPreprocessedEvidenceV0_1Preimage;
}>;

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(`${jcsCanonicalize(value)}\n`);
}

function differentHash(value: string): string {
  return value === ZERO_HASH ? ONE_HASH : ZERO_HASH;
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

function buildFixture(): Fixture {
  const manifestWithoutHash = {
    contract: "dayflow-screen-evidence-export-v0.1" as const,
    schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
    exportId: "synthetic-e2schema-stage8-export-1",
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
      fixtureSetId: "synthetic-e2schema-stage8-fixture-set-1",
      fixtureGeneratorVersion: "synthetic-e2schema-stage8-generator-v0.1",
      fixtureGeneratorSeed: "synthetic-e2schema-stage8-seed-1",
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
  const manifest = {
    ...manifestWithoutHash,
    detachedManifestSha256:
      dayflowExportManifestSha256(manifestWithoutHash),
  };
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
  const descriptor = importDayflowEvidenceBundle(input);
  const preimage: DayflowPreprocessedEvidenceV0_1Preimage = {
    schemaVersion: DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION,
    dataOrigin: "synthetic",
    studyPhase: "contract_conformance",
    studyProtocolHash: ZERO_HASH,
    transportBinding: descriptor,
    preprocessing: {
      runId: "synthetic-stage8-run-1",
      pipelineVersion: "dayflow-preprocess-v0.1",
      pipelineBuildSha256: ONE_HASH,
      privacyPolicyVersion: "privacy-v0.1",
      privacyPolicySha256: TWO_HASH,
      completedAt: COMPLETED,
      ocr: {
        execution: "on_device",
        provenanceLevel: "exact_model",
        engineId: "synthetic-ocr-engine",
        engineVersion: "ocr-v0.1",
        modelId: "synthetic-ocr-model",
        modelVersion: "model-v0.1",
        configurationSha256: THREE_HASH,
      },
    },
    captureWindow: { start: START, end: END },
    coverageCode: "valid-empty",
    coverage: manifest.coverage,
    frames: [],
  };
  return { input, descriptor, manifest, objectBytes: [], preimage };
}

function rebuildFixture(
  manifest: DayflowScreenEvidenceExport,
  objectBytes: readonly Uint8Array[],
  preimage: DayflowPreprocessedEvidenceV0_1Preimage,
): Fixture {
  if (manifest.artifacts.length !== objectBytes.length) {
    throw new Error("Artifact byte fixture count mismatch");
  }
  const manifestBytes = canonicalBytes(manifest);
  let totalObjectBytes = 0;
  const objectEntries = manifest.artifacts.map((artifact, index) => {
    const bytes = objectBytes[index]!;
    totalObjectBytes += bytes.byteLength;
    return {
      relativePath: artifact.relativeBlobRef,
      entryKind: "regular-file" as const,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
  objectEntries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
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
  const input: ImportDayflowEvidenceBundleInput = {
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
  };
  const descriptor = importDayflowEvidenceBundle(input);
  return {
    input,
    descriptor,
    manifest,
    objectBytes,
    preimage: { ...preimage, transportBinding: descriptor },
  };
}

function buildObservedFixture(artifactCount: 1 | 2 = 1): Fixture {
  const bytes =
    artifactCount === 1
      ? [SYNTHETIC_JPEG_BYTES]
      : [SYNTHETIC_JPEG_BYTES, SECOND_SYNTHETIC_JPEG_BYTES];
  const firstSha256 = rawSha256(SYNTHETIC_JPEG_BYTES);
  const firstArtifact = {
    sourceArtifactId: "synthetic-e2schema-stage9-artifact-1",
    sourceRowId: "1",
    capturedAt: START,
    sequenceWithinSecond: "0",
    idleSeconds: 0,
    relativeBlobRef: `objects/sha256/${firstSha256}.jpg`,
    mimeType: "image/jpeg" as const,
    byteSize: String(SYNTHETIC_JPEG_BYTES.byteLength),
    sha256: firstSha256,
    privacyState: "synthetic_fixture" as const,
    captureConsentRevision: "synthetic-consent-v0.1",
    capturePolicyVersion: "capture-v0.1",
    capturePolicyDecision: "allow" as const,
    pseudonymousDisplayAttestation: attestation("synthetic-display-stage9"),
    pseudonymousWindowAttestation: attestation("synthetic-window-stage9"),
    placeholderState: "synthetic_fixture" as const,
    availability: "available" as const,
  };
  const secondSha256 = rawSha256(SECOND_SYNTHETIC_JPEG_BYTES);
  const artifacts =
    artifactCount === 1
      ? [firstArtifact]
      : [
          firstArtifact,
          {
            ...firstArtifact,
            sourceArtifactId: "synthetic-e2schema-stage9-artifact-2",
            sourceRowId: "2",
            sequenceWithinSecond: "1",
            relativeBlobRef: `objects/sha256/${secondSha256}.jpg`,
            byteSize: String(SECOND_SYNTHETIC_JPEG_BYTES.byteLength),
            sha256: secondSha256,
          },
        ];
  const manifestPreimage = {
    contract: "dayflow-screen-evidence-export-v0.1" as const,
    schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
    exportId: "synthetic-e2schema-stage9-export-1",
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
      fixtureSetId: "synthetic-e2schema-stage9-fixture-set-1",
      fixtureGeneratorVersion: "synthetic-e2schema-stage9-generator-v0.1",
      fixtureGeneratorSeed: "synthetic-e2schema-stage9-seed-1",
      fixtureGeneratorConfigSha256: TWO_HASH,
    },
    consentRevision: "synthetic-consent-v0.1",
    retentionPolicyId: "synthetic-retention-v0.1",
    coverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: "running" as const,
          expectedFrameCount: artifactCount,
          observedFrameCount: artifactCount,
          rejectedFrameCount: 0,
        },
      ],
      expectedFrameCount: artifactCount,
      observedFrameCount: artifactCount,
      rejectedFrameCount: 0,
    },
    artifacts,
  };
  const manifest: DayflowScreenEvidenceExport = {
    ...manifestPreimage,
    detachedManifestSha256: dayflowExportManifestSha256(manifestPreimage),
  };
  const preimage = structuredClone(buildFixture().preimage);
  preimage.coverageCode = "observed";
  preimage.coverage = structuredClone(manifest.coverage);
  preimage.frames = manifest.artifacts.map((artifact, index) => {
    const text = `Synthetic OCR frame ${index + 1}`;
    return {
      frameOrdinal: index,
      sourceArtifactRef: {
        artifactType: "dayflow_export_frame" as const,
        exportRef: {
          schemaVersion: manifest.schemaVersion,
          exportId: manifest.exportId,
          detachedManifestSha256: manifest.detachedManifestSha256,
        },
        sourceRowId: artifact.sourceRowId,
        blobSha256: artifact.sha256,
      },
      capturedAt: artifact.capturedAt,
      result: {
        status: "text" as const,
        spans: [
          {
            spanOrdinal: 0,
            textKind: "privacy_filtered_ocr" as const,
            text,
            textSha256: rawSha256(encoder.encode(text)),
            confidence: { status: "reported" as const, basisPoints: 9_500 },
            redaction: {
              status: "none_detected" as const,
              categories: [],
            },
          },
        ],
      },
    };
  });
  return rebuildFixture(manifest, bytes, preimage);
}

function withCoverage(
  fixture: Fixture,
  coverage: DayflowScreenEvidenceExport["coverage"],
  coverageCode: DayflowPreprocessedEvidenceV0_1Preimage["coverageCode"],
): Fixture {
  const { detachedManifestSha256: _ignored, ...manifestPreimage } =
    fixture.manifest;
  const changedManifestPreimage = { ...manifestPreimage, coverage };
  const manifest: DayflowScreenEvidenceExport = {
    ...changedManifestPreimage,
    detachedManifestSha256: dayflowExportManifestSha256(
      changedManifestPreimage,
    ),
  };
  const preimage = structuredClone(fixture.preimage);
  preimage.coverage = structuredClone(coverage);
  preimage.coverageCode = coverageCode;
  return rebuildFixture(manifest, fixture.objectBytes, preimage);
}

function candidateBytes(
  preimage: DayflowPreprocessedEvidenceV0_1Preimage,
): Uint8Array {
  return serializeDayflowPreprocessedEvidenceV0_1(
    sealDayflowPreprocessedEvidenceV0_1(preimage),
  );
}

function manuallySealedBytes(
  preimage:
    | Record<string, unknown>
    | DayflowPreprocessedEvidenceV0_1Preimage,
): Uint8Array {
  return canonicalBytes({
    ...preimage,
    dayflowPreprocessedEvidenceSha256: domainSeparatedSha256(
      DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
      preimage,
    ),
  });
}

function resolveFixture(
  fixture: Fixture,
  preimage: DayflowPreprocessedEvidenceV0_1Preimage = fixture.preimage,
  manualSeal = false,
) {
  const prerequisite = verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
    capture(fixture, {
      candidateBytes: manualSeal
        ? manuallySealedBytes(preimage)
        : candidateBytes(preimage),
    }),
  );
  if (!prerequisite.valid) {
    throw new Error(
      `Expected valid prerequisites, received ${prerequisite.issueCodes.join(",")}`,
    );
  }
  return verifyPreprocessedEvidenceBundleResolutionV0_1(
    prerequisite.prerequisiteContext,
  );
}

function expectResolutionRejected(
  result: ReturnType<typeof verifyPreprocessedEvidenceBundleResolutionV0_1>,
  issueCodes: readonly PreprocessedEvidenceBundleResolutionIssueCodeV0_1[],
): void {
  expect(result).toEqual({ valid: false, issueCodes });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.issueCodes)).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["issueCodes", "valid"]);
  expect(JSON.stringify(result)).not.toMatch(
    /evidence|candidate|descriptor|manifest|bytes|context|imported/u,
  );
}

function verifyDirectFixture(
  fixture: Fixture,
  preimage: DayflowPreprocessedEvidenceV0_1Preimage = fixture.preimage,
  manualSeal = false,
  expectedDescriptor: ImportedDayflowEvidenceBundle = fixture.descriptor,
) {
  return verifyDayflowPreprocessedEvidenceV0_1(
    manualSeal ? manuallySealedBytes(preimage) : candidateBytes(preimage),
    fixture.input,
    expectedDescriptor,
  );
}

function expectDirectRejected(
  result: ReturnType<typeof verifyDayflowPreprocessedEvidenceV0_1>,
  issueCodes: readonly DayflowPreprocessedEvidenceIssueCodeV0_1[],
): void {
  expect(result).toEqual({ valid: false, issueCodes });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.issueCodes)).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["issueCodes", "valid"]);
  expect(JSON.stringify(result)).not.toMatch(
    /evidence|candidate|descriptor|bytes|relativePath|context|imported|semanticOutput|RECENT_FOCUS|VISIBLE_TASK_INTENT|"title"|"summary"/u,
  );
}

function capture(
  fixture: Fixture,
  overrides: Readonly<{
    candidateBytes?: Uint8Array;
    originalBundle?: ImportDayflowEvidenceBundleInput;
    expectedDescriptor?: ImportedDayflowEvidenceBundle;
  }> = {},
): OwnedPreprocessedEvidenceVerificationSnapshotV0_1 {
  return captureOwnedPreprocessedEvidenceVerificationSnapshotOnlyV0_1({
    candidateBytes: overrides.candidateBytes ?? candidateBytes(fixture.preimage),
    originalBundle: overrides.originalBundle ?? fixture.input,
    expectedImportedBundleDescriptor:
      overrides.expectedDescriptor ?? fixture.descriptor,
  });
}

function tamperManifest(
  input: ImportDayflowEvidenceBundleInput,
): ImportDayflowEvidenceBundleInput {
  const entries = input.entries.map((entry) => ({
    ...entry,
    bytes: new Uint8Array(entry.bytes),
  }));
  entries[0]!.bytes[0] = (entries[0]!.bytes[0] ?? 0) ^ 0xff;
  return { ...input, entries };
}

function expectRejected(
  result: ReturnType<
    typeof verifyPreprocessedEvidenceBundlePrerequisitesV0_1
  >,
  issueCode: PreprocessedEvidenceBundlePrerequisiteIssueCodeV0_1,
): void {
  expect(result).toEqual({ valid: false, issueCodes: [issueCode] });
  expect(Object.isFrozen(result)).toBe(true);
  if (result.valid) throw new Error("Expected prerequisite rejection");
  expect(Object.isFrozen(result.issueCodes)).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["issueCodes", "valid"]);
  expect(JSON.stringify(result)).not.toMatch(
    /candidate|descriptor|manifest|bytes|projection|context/u,
  );
}

function isVerifierSensitiveValue(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (
    Object.getPrototypeOf(value) === null &&
    Reflect.ownKeys(value).length === 0
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        typeof item === "string" &&
        (item.endsWith("_MISMATCH") ||
          item.endsWith("_INVALID") ||
          item === "COVERAGE" ||
          item.startsWith("SOURCE_ARTIFACT_")),
    );
  }
  const keys = Object.keys(value);
  return (
    keys.includes("candidate") ||
    keys.includes("imported") ||
    keys.includes("transportBinding") ||
    (keys.includes("descriptor") && keys.includes("resolvedManifest")) ||
    (keys.includes("manifestRawSha256") &&
      keys.includes("replayIdentitySha256")) ||
    (keys.includes("studyProtocolHash") && keys.includes("artifacts")) ||
    keys.includes("prerequisiteContext") ||
    keys.includes("issueCodes")
  );
}

describe("E2-SCHEMA-2B-2B Stage 8 prerequisites", () => {
  it("returns only an opaque prerequisite context for a truthful bundle", () => {
    const fixture = buildFixture();
    expect(fixture.preimage.dataOrigin).toBe("synthetic");
    expect(fixture.preimage.studyPhase).toBe("contract_conformance");
    const result = verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
      capture(fixture),
    );

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected valid prerequisites");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual([
      "prerequisiteContext",
      "valid",
    ]);
    expect(Object.isFrozen(result.prerequisiteContext)).toBe(true);
    expect(Object.getPrototypeOf(result.prerequisiteContext)).toBeNull();
    expect(Reflect.ownKeys(result.prerequisiteContext)).toEqual([]);
    expect(JSON.stringify(result.prerequisiteContext)).toBe("{}");
  });

  it("applies transport binding before study protocol mismatch", () => {
    const fixture = buildFixture();
    const changed = structuredClone(fixture.preimage);
    changed.transportBinding.replayIdentitySha256 = differentHash(
      changed.transportBinding.replayIdentitySha256,
    );
    const result = verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
      capture(fixture, { candidateBytes: candidateBytes(changed) }),
    );
    expectRejected(result, "TRANSPORT_BINDING_MISMATCH");
  });

  it("rejects study protocol mismatch after manifest and origin checks", () => {
    const fixture = buildFixture();
    const changed = structuredClone(fixture.preimage);
    changed.studyProtocolHash = ONE_HASH;
    expectRejected(
      verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        capture(fixture, { candidateBytes: candidateBytes(changed) }),
      ),
      "STUDY_PROTOCOL_MISMATCH",
    );
  });

  it("keeps core rejection ahead of an importer-invalid bundle", () => {
    const fixture = buildFixture();
    const snapshot = capture(fixture, {
      candidateBytes: Uint8Array.from([0x7b]),
      originalBundle: tamperManifest(fixture.input),
    });
    expectRejected(
      verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        snapshot,
      ),
      "JSON_INVALID",
    );
  });

  it("returns no partial context for transport and descriptor failures", () => {
    const fixture = buildFixture();
    expectRejected(
      verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        capture(fixture, {
          originalBundle: tamperManifest(fixture.input),
        }),
      ),
      "BUNDLE_IMPORT_REJECTED",
    );

    expectRejected(
      verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        capture(fixture, {
          expectedDescriptor: {
            ...fixture.descriptor,
            replayIdentitySha256: differentHash(
              fixture.descriptor.replayIdentitySha256,
            ),
          },
        }),
      ),
      "IMPORTED_BUNDLE_DESCRIPTOR_MISMATCH",
    );
  });

  it("rejects nonliteral origin and phase at the earlier core gate", () => {
    const fixture = buildFixture();
    for (const changes of [
      { dataOrigin: "live" },
      { studyPhase: "private_pilot" },
    ]) {
      const malformed = {
        ...structuredClone(fixture.preimage),
        ...changes,
      } as unknown as Record<string, unknown>;
      expectRejected(
        verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
          capture(fixture, {
            candidateBytes: manuallySealedBytes(malformed),
          }),
        ),
        "SCHEMA_INVALID",
      );
    }
  });

  it("keeps prerequisite state opaque from same-realm intrinsic hooks", () => {
    const fixture = buildFixture();
    const snapshot = capture(fixture);
    const protocolMismatch = structuredClone(fixture.preimage);
    protocolMismatch.studyProtocolHash = ONE_HASH;
    const protocolMismatchSnapshot = capture(fixture, {
      candidateBytes: candidateBytes(protocolMismatch),
    });
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    const createDescriptor = Object.getOwnPropertyDescriptor(Object, "create");
    const weakMapSetDescriptor = Object.getOwnPropertyDescriptor(
      WeakMap.prototype,
      "set",
    );

    if (
      freezeDescriptor === undefined ||
      createDescriptor === undefined ||
      weakMapSetDescriptor === undefined ||
      !freezeDescriptor.configurable ||
      !createDescriptor.configurable ||
      !weakMapSetDescriptor.configurable
    ) {
      const accepted = verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        snapshot,
      );
      expect(accepted.valid).toBe(true);
      if (!accepted.valid) throw new Error("Expected valid prerequisites");
      expect(Object.isFrozen(accepted)).toBe(true);
      expect(Object.isFrozen(accepted.prerequisiteContext)).toBe(true);
      expect(Reflect.ownKeys(accepted.prerequisiteContext)).toEqual([]);
      expectRejected(
        verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
          protocolMismatchSnapshot,
        ),
        "STUDY_PROTOCOL_MISMATCH",
      );
      return;
    }

    const originalFreeze = Object.freeze;
    const originalCreate = Object.create;
    const originalWeakMapSet = WeakMap.prototype.set;
    let sensitiveFreezeObservations = 0;
    let createHookCalls = 0;
    let weakMapSetHookCalls = 0;
    let hooksInstalled = false;
    let accepted:
      | ReturnType<
          typeof verifyPreprocessedEvidenceBundlePrerequisitesV0_1
        >
      | undefined;
    let rejected:
      | ReturnType<
          typeof verifyPreprocessedEvidenceBundlePrerequisitesV0_1
        >
      | undefined;

    const hostileFreeze = ((value: unknown) => {
      if (isVerifierSensitiveValue(value)) sensitiveFreezeObservations += 1;
      return originalFreeze(value);
    }) as typeof Object.freeze;
    const hostileCreate = ((
      prototype: object | null,
      properties?: PropertyDescriptorMap,
    ) => {
      createHookCalls += 1;
      return properties === undefined
        ? originalCreate(prototype)
        : originalCreate(prototype, properties);
    }) as typeof Object.create;
    const hostileWeakMapSet = function (
      this: WeakMap<object, unknown>,
      key: object,
      value: unknown,
    ): WeakMap<object, unknown> {
      weakMapSetHookCalls += 1;
      if (isVerifierSensitiveValue(key) || isVerifierSensitiveValue(value)) {
        sensitiveFreezeObservations += 1;
      }
      return Reflect.apply(originalWeakMapSet, this, [key, value]);
    };

    try {
      Object.defineProperty(Object, "freeze", {
        ...freezeDescriptor,
        value: hostileFreeze,
      });
      Object.defineProperty(Object, "create", {
        ...createDescriptor,
        value: hostileCreate,
      });
      Object.defineProperty(WeakMap.prototype, "set", {
        ...weakMapSetDescriptor,
        value: hostileWeakMapSet,
      });
      hooksInstalled =
        Object.freeze === hostileFreeze &&
        Object.create === hostileCreate &&
        WeakMap.prototype.set === hostileWeakMapSet;
      accepted = verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        snapshot,
      );
      rejected = verifyPreprocessedEvidenceBundlePrerequisitesV0_1(
        protocolMismatchSnapshot,
      );
    } finally {
      Object.defineProperty(Object, "freeze", freezeDescriptor);
      Object.defineProperty(Object, "create", createDescriptor);
      Object.defineProperty(
        WeakMap.prototype,
        "set",
        weakMapSetDescriptor,
      );
    }

    expect(hooksInstalled).toBe(true);
    expect(sensitiveFreezeObservations).toBe(0);
    expect(createHookCalls).toBe(0);
    expect(weakMapSetHookCalls).toBe(0);
    expect(accepted?.valid).toBe(true);
    if (accepted === undefined || !accepted.valid) {
      throw new Error("Expected valid prerequisites");
    }
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.prerequisiteContext)).toBe(true);
    expect(Object.getPrototypeOf(accepted.prerequisiteContext)).toBeNull();
    expect(Reflect.ownKeys(accepted.prerequisiteContext)).toEqual([]);
    expect(JSON.stringify(accepted.prerequisiteContext)).toBe("{}");
    if (rejected === undefined) throw new Error("Expected rejection result");
    expectRejected(rejected, "STUDY_PROTOCOL_MISMATCH");
  });
});

describe("E2-SCHEMA-2B-2B Stage 9 resolution", () => {
  it("rejects forged contexts and returns deep-frozen valid-empty evidence", () => {
    const forged = Object.freeze(
      Object.create(null),
    ) as OwnedPreprocessedEvidenceBundlePrerequisiteContextV0_1;
    expectResolutionRejected(
      verifyPreprocessedEvidenceBundleResolutionV0_1(forged),
      ["INPUT_INVALID"],
    );

    const result = resolveFixture(buildFixture());
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected resolved evidence");
    expect(Object.keys(result).sort()).toEqual([
      "evidence",
      "issueCodes",
      "valid",
    ]);
    expect(result.issueCodes).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issueCodes)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(Object.isFrozen(result.evidence.coverage)).toBe(true);
    expect(Object.isFrozen(result.evidence.coverage.intervals)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /semanticOutput|RECENT_FOCUS|VISIBLE_TASK_INTENT|"title"|"summary"/u,
    );
  });

  it("moves capture-window ownership from Stage 8 to Stage 9", () => {
    const fixture = buildFixture();
    const changed = structuredClone(fixture.preimage);
    changed.captureWindow.start = "2026-08-20T00:00:00.500Z";
    expectResolutionRejected(resolveFixture(fixture, changed), [
      "CAPTURE_WINDOW_MISMATCH",
    ]);
  });

  it("applies exact coverage mismatch, code, and failure precedence", () => {
    const fixture = buildFixture();
    const mismatched = structuredClone(fixture.preimage);
    mismatched.coverage.intervals[0]!.reason = "locked";
    mismatched.coverageCode = "observed";
    expectResolutionRejected(resolveFixture(fixture, mismatched, true), [
      "COVERAGE_MISMATCH",
    ]);

    const wrongCode = structuredClone(fixture.preimage);
    wrongCode.coverageCode = "observed";
    expectResolutionRejected(resolveFixture(fixture, wrongCode, true), [
      "COVERAGE_CODE_MISMATCH",
    ]);

    const failureCoverage = {
      intervals: [
        {
          start: START,
          end: END,
          reason: "missing" as const,
          expectedFrameCount: 1,
          observedFrameCount: 0,
          rejectedFrameCount: 0,
        },
      ],
      expectedFrameCount: 1,
      observedFrameCount: 0,
      rejectedFrameCount: 0,
    };
    const failure = withCoverage(fixture, failureCoverage, "failure");
    expectResolutionRejected(
      resolveFixture(failure, failure.preimage, true),
      ["COVERAGE_FAILURE"],
    );
  });

  it("merges, deduplicates, and ASCII-orders intrinsic issues", () => {
    const fixture = buildObservedFixture();
    const changed = structuredClone(fixture.preimage);
    changed.captureWindow.start = "2026-08-20T00:00:00.500Z";
    changed.frames[0]!.result.spans[0]!.textSha256 = ZERO_HASH;
    expectResolutionRejected(resolveFixture(fixture, changed, true), [
      "CAPTURE_WINDOW_MISMATCH",
      "OCR_TEXT_HASH_MISMATCH",
    ]);
  });

  it("resolves an exact one-JPEG source without suggestion semantics", () => {
    const result = resolveFixture(buildObservedFixture());
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected resolved evidence");
    expect(result.issueCodes).toEqual([]);
    expect(Object.isFrozen(result.evidence.frames)).toBe(true);
    expect(Object.isFrozen(result.evidence.frames[0])).toBe(true);
    expect(Object.isFrozen(result.evidence.frames[0]!.sourceArtifactRef)).toBe(
      true,
    );
    expect(Object.isFrozen(result.evidence.frames[0]!.result)).toBe(true);
    expect(JSON.stringify(result.evidence)).not.toMatch(
      /semanticOutput|RECENT_FOCUS|VISIBLE_TASK_INTENT|"title"|"summary"/u,
    );
  });

  it("detects ordered source reorder, missing, duplicate, and substitution", () => {
    const fixture = buildObservedFixture(2);

    const reordered = structuredClone(fixture.preimage);
    const firstRef = reordered.frames[0]!.sourceArtifactRef;
    reordered.frames[0]!.sourceArtifactRef =
      reordered.frames[1]!.sourceArtifactRef;
    reordered.frames[1]!.sourceArtifactRef = firstRef;
    expectResolutionRejected(resolveFixture(fixture, reordered, true), [
      "SOURCE_ARTIFACT_SET_MISMATCH",
    ]);

    const missing = structuredClone(fixture.preimage);
    missing.frames = [missing.frames[0]!];
    expectResolutionRejected(resolveFixture(fixture, missing, true), [
      "RESOURCE_COUNT_MISMATCH",
      "SOURCE_ARTIFACT_SET_MISMATCH",
    ]);

    const duplicate = structuredClone(fixture.preimage);
    duplicate.frames[1]!.sourceArtifactRef = structuredClone(
      duplicate.frames[0]!.sourceArtifactRef,
    );
    expectResolutionRejected(resolveFixture(fixture, duplicate, true), [
      "SOURCE_ARTIFACT_SET_MISMATCH",
    ]);

    const substituted = structuredClone(fixture.preimage);
    substituted.frames[1]!.sourceArtifactRef.sourceRowId = "3";
    expectResolutionRejected(resolveFixture(fixture, substituted, true), [
      "SOURCE_ARTIFACT_SET_MISMATCH",
    ]);
  });

  it("checks resolvable binding independently from owner and set ledgers", () => {
    const fixture = buildObservedFixture();
    const ownerAbsent = structuredClone(fixture.preimage);
    ownerAbsent.frames[0]!.capturedAt = "2026-08-20T00:00:00.500Z";
    expectResolutionRejected(resolveFixture(fixture, ownerAbsent, true), [
      "SOURCE_ARTIFACT_BINDING_MISMATCH",
    ]);

    const two = buildObservedFixture(2);
    const both = structuredClone(two.preimage);
    const firstRef = both.frames[0]!.sourceArtifactRef;
    both.frames[0]!.sourceArtifactRef = both.frames[1]!.sourceArtifactRef;
    both.frames[1]!.sourceArtifactRef = firstRef;
    both.frames[0]!.sourceArtifactRef.exportRef.exportId =
      "synthetic-e2schema-stage9-export-substituted";
    expectResolutionRejected(resolveFixture(two, both, true), [
      "SOURCE_ARTIFACT_BINDING_MISMATCH",
      "SOURCE_ARTIFACT_SET_MISMATCH",
    ]);
  });
});

describe("verifyDayflowPreprocessedEvidenceV0_1 contract", () => {
  it("returns exact frozen valid-empty and observed success shapes", () => {
    for (const fixture of [buildFixture(), buildObservedFixture()]) {
      const result = verifyDirectFixture(fixture);
      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error("Expected verified evidence");
      expect(Object.keys(result).sort()).toEqual([
        "evidence",
        "issueCodes",
        "valid",
      ]);
      expect(result.issueCodes).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.issueCodes)).toBe(true);
      expect(Object.isFrozen(result.evidence)).toBe(true);
      expect(Object.isFrozen(result.evidence.frames)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /semanticOutput|RECENT_FOCUS|VISIBLE_TASK_INTENT|"title"|"summary"/u,
      );
    }
  });

  it("closes hostile roots, accessors, sparse entries, and candidate caps", () => {
    const fixture = buildFixture();
    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        null as unknown as Uint8Array,
        fixture.input,
        fixture.descriptor,
      ),
      ["INPUT_INVALID"],
    );

    let proxyTrapCalls = 0;
    const proxyBundle = new Proxy(fixture.input, {
      get() {
        proxyTrapCalls += 1;
        throw new Error("proxy get must not run");
      },
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error("proxy ownKeys must not run");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls += 1;
        throw new Error("proxy descriptor must not run");
      },
    });
    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        candidateBytes(fixture.preimage),
        proxyBundle,
        fixture.descriptor,
      ),
      ["INPUT_INVALID"],
    );
    expect(proxyTrapCalls).toBe(0);

    let getterCalls = 0;
    const accessorBundle = { ...fixture.input };
    Object.defineProperty(accessorBundle, "bundleId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return BUNDLE_ID;
      },
    });
    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        candidateBytes(fixture.preimage),
        accessorBundle,
        fixture.descriptor,
      ),
      ["INPUT_INVALID"],
    );
    expect(getterCalls).toBe(0);

    const sparseEntries = fixture.input.entries.slice(0, 0);
    sparseEntries.length = fixture.input.entries.length;
    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        candidateBytes(fixture.preimage),
        { ...fixture.input, entries: sparseEntries },
        fixture.descriptor,
      ),
      ["INPUT_INVALID"],
    );

    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        new Uint8Array(
          DAYFLOW_PREPROCESSED_EVIDENCE_VERIFICATION_SNAPSHOT_LIMITS
            .candidateBytes + 1,
        ),
        fixture.input,
        fixture.descriptor,
      ),
      ["RESOURCE_LIMIT_EXCEEDED"],
    );
  });

  it("keeps core failures before transport and maps transport failures", () => {
    const fixture = buildFixture();
    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        Uint8Array.from([0x7b]),
        tamperManifest(fixture.input),
        fixture.descriptor,
      ),
      ["JSON_INVALID"],
    );
    expectDirectRejected(
      verifyDayflowPreprocessedEvidenceV0_1(
        candidateBytes(fixture.preimage),
        tamperManifest(fixture.input),
        fixture.descriptor,
      ),
      ["TRANSPORT_REVERIFY_FAILED"],
    );
  });

  it("separates expected and candidate transport binding failures", () => {
    const fixture = buildFixture();
    expectDirectRejected(
      verifyDirectFixture(fixture, fixture.preimage, false, {
        ...fixture.descriptor,
        replayIdentitySha256: differentHash(
          fixture.descriptor.replayIdentitySha256,
        ),
      }),
      ["TRANSPORT_BINDING_MISMATCH"],
    );

    const changed = structuredClone(fixture.preimage);
    changed.transportBinding.replayIdentitySha256 = differentHash(
      changed.transportBinding.replayIdentitySha256,
    );
    expectDirectRejected(verifyDirectFixture(fixture, changed), [
      "TRANSPORT_BINDING_MISMATCH",
    ]);
  });

  it("derives protocol mismatch from candidate and resolved manifest", () => {
    const fixture = buildFixture();
    const changed = structuredClone(fixture.preimage);
    changed.studyProtocolHash = ONE_HASH;
    expectDirectRejected(verifyDirectFixture(fixture, changed), [
      "STUDY_PROTOCOL_MISMATCH",
    ]);
  });

  it("returns sorted deduplicated Stage 9 issues without partial state", () => {
    const fixture = buildObservedFixture();
    const changed = structuredClone(fixture.preimage);
    changed.captureWindow.start = "2026-08-20T00:00:00.500Z";
    changed.frames[0]!.result.spans[0]!.textSha256 = ZERO_HASH;
    expectDirectRejected(verifyDirectFixture(fixture, changed, true), [
      "CAPTURE_WINDOW_MISMATCH",
      "OCR_TEXT_HASH_MISMATCH",
    ]);
  });
});
