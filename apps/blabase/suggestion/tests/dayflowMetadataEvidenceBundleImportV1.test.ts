import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DAYFLOW_METADATA_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
  DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1,
  DayflowMetadataEvidenceImportErrorV1,
  importDayflowMetadataEvidenceBundleV1,
  type DayflowMetadataEvidenceImportIssueCodeV1,
  type ImportDayflowMetadataEvidenceBundleV1Input,
} from "../src/evaluation/dayflowAblation/importDayflowMetadataEvidenceBundleV1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EXPORT_RUN_ID = "synthetic-task1b-export-1";

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = sortedJsonValue((value as Record<string, unknown>)[key]);
  }
  return result;
}

function foundationSortedBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(sortedJsonValue(value)));
}

function payloadFixture(): Record<string, unknown> {
  return {
    schemaVersion: "dayflow.blabase-evidence-bundle.v1",
    exporterVersion: "dayflow.blabase-evidence-exporter.v2",
    exportRunId: EXPORT_RUN_ID,
    window: {
      startEpochSecond: 100,
      endEpochSecond: 130,
    },
    provenance: {
      sourceSystem: "dayflow.sqlite",
      sourceDatabaseSchemaUserVersion: 1,
      snapshotSemantics: "grdb.database-pool.read-snapshot",
      preprocessingVersion: "dayflow.metadata-only.preprocessing.v1",
      privacyProfile: "metadata-only.v1",
      observationTextPolicy: "excluded-unverified",
    },
    screenshots: [
      {
        screenshotId: 1,
        capturedAtEpochSecond: 100,
        fileSizeBytes: 10,
        idleSecondsAtCapture: 0,
      },
      {
        screenshotId: 2,
        capturedAtEpochSecond: 120,
      },
    ],
    batches: [
      {
        batchId: 10,
        startEpochSecond: 100,
        endEpochSecond: 130,
        status: "completed",
      },
    ],
    batchScreenshotLinks: [
      { batchId: 10, screenshotId: 1 },
      { batchId: 10, screenshotId: 2 },
    ],
    observationMetadata: [
      {
        observationId: 100,
        batchId: 10,
        startEpochSecond: 100,
        endEpochSecond: 130,
      },
    ],
    coverage: {
      requestedWindowSeconds: 31,
      screenshotCount: 2,
      linkedBatchCount: 1,
      observationMetadataCount: 1,
      firstCapturedAtEpochSecond: 100,
      lastCapturedAtEpochSecond: 120,
      observedSpanSeconds: 21,
      captureGapThresholdSeconds: 30,
      gaps: [],
    },
    missingFields: [
      {
        recordKind: "screenshot",
        recordId: 2,
        fields: ["fileSizeBytes", "idleSecondsAtCapture"],
      },
      {
        recordKind: "observation-metadata",
        recordId: 100,
        fields: ["producerModelSha256"],
      },
    ],
    issues: [
      {
        code: "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
        severity: "warning",
        affectedRecordCount: 1,
      },
      {
        code: "OPTIONAL_SOURCE_METADATA_MISSING",
        severity: "warning",
        affectedRecordCount: 2,
      },
    ],
  };
}

function inputFromPayloadBytes(
  payloadBytes: Uint8Array,
): ImportDayflowMetadataEvidenceBundleV1Input {
  const manifest = {
    schemaVersion: "dayflow.blabase-evidence-manifest.v1",
    canonicalizationProfile:
      "foundation.sorted-keys.no-whitespace.integer-domain.v1",
    exportRunId: EXPORT_RUN_ID,
    exporterVersion: "dayflow.blabase-evidence-exporter.v2",
    payloadFile: "payload.json",
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256: rawSha256(payloadBytes),
  };
  const manifestBytes = foundationSortedBytes(manifest);
  const manifestSha256 = rawSha256(manifestBytes);
  const markerBytes = encoder.encode(manifestSha256);
  return {
    mode: "synthetic-task1-handoff",
    bundleDirectoryName: EXPORT_RUN_ID,
    entries: [
      {
        relativePath: "payload.json",
        entryKind: "regular-file",
        byteLength: payloadBytes.byteLength,
        bytes: payloadBytes,
      },
      {
        relativePath: "manifest.json",
        entryKind: "regular-file",
        byteLength: manifestBytes.byteLength,
        bytes: manifestBytes,
      },
      {
        relativePath: "manifest.sha256",
        entryKind: "regular-file",
        byteLength: markerBytes.byteLength,
        bytes: markerBytes,
      },
      {
        relativePath: "COMPLETE",
        entryKind: "regular-file",
        byteLength: markerBytes.byteLength,
        bytes: new Uint8Array(markerBytes),
      },
    ],
  };
}

function buildInput(
  payload: Record<string, unknown> = payloadFixture(),
): ImportDayflowMetadataEvidenceBundleV1Input {
  return inputFromPayloadBytes(foundationSortedBytes(payload));
}

function replaceEntryBytes(
  input: ImportDayflowMetadataEvidenceBundleV1Input,
  relativePath: string,
  bytes: Uint8Array,
): ImportDayflowMetadataEvidenceBundleV1Input {
  return {
    ...input,
    entries: input.entries.map((entry) =>
      entry.relativePath === relativePath
        ? { ...entry, byteLength: bytes.byteLength, bytes }
        : entry,
    ),
  };
}

function replaceManifestBytesAndMarkers(
  input: ImportDayflowMetadataEvidenceBundleV1Input,
  manifestBytes: Uint8Array,
): ImportDayflowMetadataEvidenceBundleV1Input {
  const markerBytes = encoder.encode(rawSha256(manifestBytes));
  return replaceEntryBytes(
    replaceEntryBytes(
      replaceEntryBytes(input, "manifest.json", manifestBytes),
      "manifest.sha256",
      markerBytes,
    ),
    "COMPLETE",
    new Uint8Array(markerBytes),
  );
}

function expectIssue(
  candidate: unknown,
  issueCode: DayflowMetadataEvidenceImportIssueCodeV1,
): void {
  try {
    importDayflowMetadataEvidenceBundleV1(
      candidate as ImportDayflowMetadataEvidenceBundleV1Input,
    );
    throw new TypeError("Expected metadata bundle import to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DayflowMetadataEvidenceImportErrorV1);
    if (!(error instanceof DayflowMetadataEvidenceImportErrorV1)) throw error;
    expect(error.issueCode).toBe(issueCode);
    expect(error.message).toBe(
      "Dayflow metadata evidence import failed (" + issueCode + ")",
    );
  }
}

describe("Task 1B Dayflow metadata evidence handoff", () => {
  it("imports the exact four-file bundle deterministically and freezes output", () => {
    const input = buildInput();
    const first = importDayflowMetadataEvidenceBundleV1(input);
    const second = importDayflowMetadataEvidenceBundleV1(buildInput());
    const manifestBytes = input.entries.find(
      (entry) => entry.relativePath === "manifest.json",
    )!.bytes;
    const payloadBytes = input.entries.find(
      (entry) => entry.relativePath === "payload.json",
    )!.bytes;

    expect(second).toEqual(first);
    expect(first.descriptor).toEqual({
      importSchemaVersion:
        DAYFLOW_METADATA_EVIDENCE_BUNDLE_IMPORT_SCHEMA_VERSION,
      exportRunId: EXPORT_RUN_ID,
      manifestByteCount: manifestBytes.byteLength,
      manifestSha256: rawSha256(manifestBytes),
      payloadByteCount: payloadBytes.byteLength,
      payloadSha256: rawSha256(payloadBytes),
      replayIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.evidence).toEqual(payloadFixture());
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.descriptor)).toBe(true);
    expect(Object.isFrozen(first.manifest)).toBe(true);
    expect(Object.isFrozen(first.evidence)).toBe(true);
    expect(Object.isFrozen(first.evidence.screenshots)).toBe(true);
    expect(Object.isFrozen(first.evidence.screenshots[0])).toBe(true);
  });

  it("rejects marker, manifest, payload, and entry-set mutations", () => {
    const input = buildInput();
    expectIssue(
      replaceEntryBytes(input, "COMPLETE", encoder.encode("0".repeat(64))),
      "MARKER_INVALID",
    );

    const wrongDetached = encoder.encode("1".repeat(64));
    expectIssue(
      replaceEntryBytes(
        replaceEntryBytes(input, "manifest.sha256", wrongDetached),
        "COMPLETE",
        wrongDetached,
      ),
      "HASH_BINDING_MISMATCH",
    );

    const payloadEntry = input.entries.find(
      (entry) => entry.relativePath === "payload.json",
    )!;
    const changedPayload = new Uint8Array(payloadEntry.bytes);
    changedPayload[changedPayload.byteLength - 1] ^= 1;
    expectIssue(
      replaceEntryBytes(input, "payload.json", changedPayload),
      "HASH_BINDING_MISMATCH",
    );

    expectIssue(
      {
        ...input,
        entries: [
          ...input.entries,
          {
            relativePath: "extra.json",
            entryKind: "regular-file",
            byteLength: 2,
            bytes: encoder.encode("{}"),
          },
        ],
      },
      "ENTRY_SET_MISMATCH",
    );
  });

  it("rejects the legacy v1 exporter identity in payload and manifest", () => {
    const legacyPayload = payloadFixture();
    legacyPayload.exporterVersion = "dayflow.blabase-evidence-exporter.v1";
    expectIssue(buildInput(legacyPayload), "PAYLOAD_INVALID");

    const input = buildInput();
    const manifestEntry = input.entries.find(
      (entry) => entry.relativePath === "manifest.json",
    )!;
    const legacyManifest = JSON.parse(
      decoder.decode(manifestEntry.bytes),
    ) as Record<string, unknown>;
    legacyManifest.exporterVersion = "dayflow.blabase-evidence-exporter.v1";
    expectIssue(
      replaceManifestBytesAndMarkers(
        input,
        foundationSortedBytes(legacyManifest),
      ),
      "MANIFEST_INVALID",
    );
  });

  it("requires a nonempty positive-ID screenshot selection", () => {
    const emptyScreenshots = payloadFixture();
    emptyScreenshots.screenshots = [];
    expectIssue(buildInput(emptyScreenshots), "PAYLOAD_INVALID");

    const zeroScreenshotId = payloadFixture();
    (
      zeroScreenshotId.screenshots as Array<Record<string, unknown>>
    )[0]!.screenshotId = 0;
    expectIssue(buildInput(zeroScreenshotId), "PAYLOAD_INVALID");

    const zeroLinkedScreenshotId = payloadFixture();
    (
      zeroLinkedScreenshotId.batchScreenshotLinks as Array<
        Record<string, unknown>
      >
    )[0]!.screenshotId = 0;
    expectIssue(buildInput(zeroLinkedScreenshotId), "PAYLOAD_INVALID");
  });

  it("rejects duplicate-key JSON and BOM", () => {
    const validText = decoder.decode(
      foundationSortedBytes(payloadFixture()),
    );
    const duplicateText = validText.replace(
      "{",
      '{"schemaVersion":"dayflow.blabase-evidence-bundle.v1",',
    );
    expectIssue(
      inputFromPayloadBytes(encoder.encode(duplicateText)),
      "JSON_DUPLICATE_KEY",
    );

    const validBytes = foundationSortedBytes(payloadFixture());
    const bomBytes = new Uint8Array(validBytes.byteLength + 3);
    bomBytes.set([0xef, 0xbb, 0xbf]);
    bomBytes.set(validBytes, 3);
    expectIssue(inputFromPayloadBytes(bomBytes), "JSON_INVALID");

  });

  it("enforces the shared maximum wire integer exactly", () => {
    const boundary = payloadFixture();
    (
      boundary.provenance as Record<string, unknown>
    ).sourceDatabaseSchemaUserVersion = 9_007_199_254_740_991;
    expect(
      importDayflowMetadataEvidenceBundleV1(buildInput(boundary)).evidence
        .provenance.sourceDatabaseSchemaUserVersion,
    ).toBe(9_007_199_254_740_991);

    const unsafe = payloadFixture();
    (
      unsafe.provenance as Record<string, unknown>
    ).sourceDatabaseSchemaUserVersion = 9_007_199_254_740_992;
    expectIssue(buildInput(unsafe), "PAYLOAD_INVALID");
  });

  it("requires exact sorted-key, no-whitespace canonical bytes", () => {
    const canonicalPayloadText = decoder.decode(
      foundationSortedBytes(payloadFixture()),
    );
    expectIssue(
      inputFromPayloadBytes(encoder.encode(" " + canonicalPayloadText)),
      "PAYLOAD_INVALID",
    );
    expectIssue(
      inputFromPayloadBytes(
        encoder.encode(JSON.stringify(payloadFixture())),
      ),
      "PAYLOAD_INVALID",
    );
    expectIssue(
      inputFromPayloadBytes(
        encoder.encode(
          canonicalPayloadText.replace(
            '"sourceDatabaseSchemaUserVersion":1',
            '"sourceDatabaseSchemaUserVersion":1.0',
          ),
        ),
      ),
      "PAYLOAD_INVALID",
    );

    const input = buildInput();
    const manifestEntry = input.entries.find(
      (entry) => entry.relativePath === "manifest.json",
    )!;
    const manifest = JSON.parse(
      decoder.decode(manifestEntry.bytes),
    ) as Record<string, unknown>;
    const reverseKeyManifest = Object.fromEntries(
      Object.entries(manifest).reverse(),
    );
    expectIssue(
      replaceManifestBytesAndMarkers(
        input,
        encoder.encode(JSON.stringify(reverseKeyManifest)),
      ),
      "MANIFEST_INVALID",
    );
    const manifestText = decoder.decode(manifestEntry.bytes);
    expectIssue(
      replaceManifestBytesAndMarkers(
        input,
        encoder.encode(
          manifestText.replace(
            /"payloadByteCount":(\d+)/u,
            '"payloadByteCount":$1.0',
          ),
        ),
      ),
      "MANIFEST_INVALID",
    );
  });

  it("allows only frozen metadata tokens instead of arbitrary strings", () => {
    const hashedModel = payloadFixture();
    const hashedObservation = (
      hashedModel.observationMetadata as Array<Record<string, unknown>>
    )[0]!;
    hashedObservation.producerModelSha256 = "a".repeat(64);
    (hashedModel.missingFields as unknown[]).pop();
    (
      (hashedModel.issues as Array<Record<string, unknown>>)[1]!
    ).affectedRecordCount = 1;
    expect(
      importDayflowMetadataEvidenceBundleV1(buildInput(hashedModel)).evidence
        .observationMetadata[0]!.producerModelSha256,
    ).toBe("a".repeat(64));

    const smuggledPreprocessing = payloadFixture();
    (
      smuggledPreprocessing.provenance as Record<string, unknown>
    ).preprocessingVersion = "dayflow.metadata-only.preprocessing.v1-private";
    expectIssue(buildInput(smuggledPreprocessing), "PAYLOAD_INVALID");

    const smuggledStatus = payloadFixture();
    (
      smuggledStatus.batches as Array<Record<string, unknown>>
    )[0]!.status = "completed;show-suggestion";
    expectIssue(buildInput(smuggledStatus), "PAYLOAD_INVALID");

    const smuggledModel = payloadFixture();
    (
      smuggledModel.observationMetadata as Array<Record<string, unknown>>
    )[0]!.producerModelSha256 = "private-model-name";
    expectIssue(buildInput(smuggledModel), "PAYLOAD_INVALID");
  });

  it("rejects non-canonical wire order and dangling references", () => {
    const reversed = payloadFixture();
    (reversed.screenshots as unknown[]).reverse();
    expectIssue(buildInput(reversed), "ORDER_INVALID");

    const dangling = payloadFixture();
    (dangling.batchScreenshotLinks as Array<Record<string, unknown>>)[1] = {
      batchId: 99,
      screenshotId: 2,
    };
    expectIssue(buildInput(dangling), "REFERENCE_INVALID");
  });

  it("recomputes coverage, missing-field, and issue projections", () => {
    const wrongCoverage = payloadFixture();
    (
      wrongCoverage.coverage as Record<string, unknown>
    ).screenshotCount = 3;
    expectIssue(buildInput(wrongCoverage), "COVERAGE_INVALID");

    const wrongMissing = payloadFixture();
    (wrongMissing.missingFields as unknown[]).pop();
    expectIssue(buildInput(wrongMissing), "COVERAGE_INVALID");

    const wrongIssues = payloadFixture();
    (
      (wrongIssues.issues as Array<Record<string, unknown>>)[1]!
    ).affectedRecordCount = 1;
    expectIssue(buildInput(wrongIssues), "COVERAGE_INVALID");
  });

  it("requires inclusive observation overlap and the trusted gap policy", () => {
    const boundaryOverlap = payloadFixture();
    const boundaryObservation = (
      boundaryOverlap.observationMetadata as Array<Record<string, unknown>>
    )[0]!;
    boundaryObservation.startEpochSecond = 130;
    boundaryObservation.endEpochSecond = 130;
    expect(
      importDayflowMetadataEvidenceBundleV1(buildInput(boundaryOverlap))
        .evidence.observationMetadata[0]!.startEpochSecond,
    ).toBe(130);

    const afterWindow = payloadFixture();
    const afterObservation = (
      afterWindow.observationMetadata as Array<Record<string, unknown>>
    )[0]!;
    afterObservation.startEpochSecond = 131;
    afterObservation.endEpochSecond = 132;
    expectIssue(buildInput(afterWindow), "REFERENCE_INVALID");

    const beforeWindow = payloadFixture();
    const beforeObservation = (
      beforeWindow.observationMetadata as Array<Record<string, unknown>>
    )[0]!;
    beforeObservation.startEpochSecond = 98;
    beforeObservation.endEpochSecond = 99;
    expectIssue(buildInput(beforeWindow), "REFERENCE_INVALID");

    const untrustedThreshold = payloadFixture();
    (
      untrustedThreshold.coverage as Record<string, unknown>
    ).captureGapThresholdSeconds = 31;
    expectIssue(buildInput(untrustedThreshold), "PAYLOAD_INVALID");
  });

  it("rejects forbidden suggestion and private-data fields at any depth", () => {
    const payload = payloadFixture();
    (
      payload.provenance as Record<string, unknown>
    ).semanticOutput = "forbidden";
    expectIssue(buildInput(payload), "FORBIDDEN_FIELD");
  });

  it("enforces byte and cardinality resource caps", () => {
    expect(DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1).toEqual({
      manifestBytes: 16 * 1024,
      payloadBytes: 5 * 1024 * 1024,
      screenshots: 10_000,
      batches: 10_000,
      batchScreenshotLinks: 20_000,
      observationMetadata: 10_000,
      gaps: 10_001,
      missingFields: 20_000,
      issues: 6,
    });

    expectIssue(
      inputFromPayloadBytes(
        new Uint8Array(
          DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.payloadBytes + 1,
        ),
      ),
      "RESOURCE_LIMIT_EXCEEDED",
    );
    expectIssue(
      replaceManifestBytesAndMarkers(
        buildInput(),
        new Uint8Array(
          DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.manifestBytes + 1,
        ),
      ),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const tooManyIssues = payloadFixture();
    const issues = tooManyIssues.issues as unknown[];
    while (
      issues.length <= DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.issues
    ) {
      issues.push({
        code: "CAPTURE_GAP_DETECTED",
        severity: "warning",
        affectedRecordCount: 0,
      });
    }
    expectIssue(buildInput(tooManyIssues), "PAYLOAD_INVALID");
  });

  it("rejects hostile caller objects and owns accepted bytes", () => {
    const input = buildInput();
    const firstEntry = input.entries[0]!;
    const accessorEntry = { ...firstEntry } as Record<string, unknown>;
    Object.defineProperty(accessorEntry, "bytes", {
      enumerable: true,
      get: () => firstEntry.bytes,
    });
    expectIssue(
      { ...input, entries: [accessorEntry, ...input.entries.slice(1)] },
      "BUNDLE_INPUT_INVALID",
    );

    const accessorRoot = { ...input } as Record<string, unknown>;
    Object.defineProperty(accessorRoot, "mode", {
      enumerable: true,
      get: () => input.mode,
    });
    expectIssue(accessorRoot, "BUNDLE_INPUT_INVALID");
    expectIssue(new Proxy(input, {}), "BUNDLE_INPUT_INVALID");

    class Uint8ArraySubclass extends Uint8Array {}
    expectIssue(
      replaceEntryBytes(
        input,
        "payload.json",
        new Uint8ArraySubclass(firstEntry.bytes),
      ),
      "BUNDLE_INPUT_INVALID",
    );

    if (typeof SharedArrayBuffer === "function") {
      const sharedBytes = new Uint8Array(
        new SharedArrayBuffer(firstEntry.bytes.byteLength),
      );
      sharedBytes.set(firstEntry.bytes);
      expectIssue(
        replaceEntryBytes(input, "payload.json", sharedBytes),
        "BUNDLE_INPUT_INVALID",
      );
    }

    const ownedInput = buildInput();
    const ownedPayloadEntry = ownedInput.entries.find(
      (entry) => entry.relativePath === "payload.json",
    )!;
    const originalPayloadSha256 = rawSha256(ownedPayloadEntry.bytes);
    const imported = importDayflowMetadataEvidenceBundleV1(ownedInput);
    ownedPayloadEntry.bytes.fill(0);
    expect(imported.descriptor.payloadSha256).toBe(originalPayloadSha256);
    expect(imported.evidence).toEqual(payloadFixture());
  });
});

describe("Task 1D synthetic importer isolation", () => {
  it("does not accept the real private-pilot source label", () => {
    expect(() =>
      importDayflowMetadataEvidenceBundleV1({
        ...buildInput(),
        mode: "real-private-pilot",
      } as unknown as Parameters<
        typeof importDayflowMetadataEvidenceBundleV1
      >[0]),
    ).toThrowError(
      expect.objectContaining({ issueCode: "BUNDLE_INPUT_INVALID" }),
    );
  });
});
