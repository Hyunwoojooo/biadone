import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../src/dayflowEvidence/contracts";
import {
  rawSha256,
} from "../src/evaluation/privateArtifactStore";
import type { StructuredCurrentWorkEvidenceDescriptorV1 } from "../src/evaluation/dayflowAblation/captureStructuredCurrentWorkEvidenceV1";
import {
  importDayflowMetadataEvidenceBundleV1,
} from "../src/evaluation/dayflowAblation/importDayflowMetadataEvidenceBundleV1";
import type {
  DayflowMetadataEvidenceBundleEntryV1,
  ImportedDayflowMetadataEvidenceBundleV1,
} from "../src/evaluation/dayflowAblation/importDayflowMetadataEvidenceBundleV1";
import {
  buildTask1EvaluationInputSealV1,
  publishTask1EvaluationInputSealV1,
  TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
  TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
  TASK1C_POLICY_ID,
  Task1EvaluationInputSealErrorV1,
  verifyPublishedTask1EvaluationInputSealV1,
} from "../src/evaluation/dayflowAblation/sealTask1EvaluationInputV1";
import type {
  BuildTask1EvaluationInputSealV1Input,
} from "../src/evaluation/dayflowAblation/sealTask1EvaluationInputV1";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const START_EPOCH_SECOND = 1_800_000_000;
const END_EPOCH_SECOND = START_EPOCH_SECOND + 599;
const EXPORT_RUN_ID = "synthetic-task1c-seal";

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(jcsCanonicalize(value));
}

function sourceEntry(
  relativePath: string,
  bytes: Uint8Array,
): DayflowMetadataEvidenceBundleEntryV1 {
  return Object.freeze({
    relativePath,
    entryKind: "regular-file" as const,
    byteLength: bytes.byteLength,
    bytes: new Uint8Array(bytes),
  });
}

function syntheticDayflowBundle(): Readonly<{
  imported: ImportedDayflowMetadataEvidenceBundleV1;
  copySourceEntries: () => readonly DayflowMetadataEvidenceBundleEntryV1[];
}> {
  const payload = {
    schemaVersion: "dayflow.blabase-evidence-bundle.v1" as const,
    exporterVersion: "dayflow.blabase-evidence-exporter.v2" as const,
    exportRunId: EXPORT_RUN_ID,
    window: {
      startEpochSecond: START_EPOCH_SECOND,
      endEpochSecond: END_EPOCH_SECOND,
    },
    provenance: {
      sourceSystem: "dayflow.sqlite" as const,
      sourceDatabaseSchemaUserVersion: 1,
      snapshotSemantics: "grdb.database-pool.read-snapshot" as const,
      preprocessingVersion: "dayflow.metadata-only.preprocessing.v1" as const,
      privacyProfile: "metadata-only.v1" as const,
      observationTextPolicy: "excluded-unverified" as const,
    },
    screenshots: [
      {
        screenshotId: 1,
        capturedAtEpochSecond: START_EPOCH_SECOND,
        fileSizeBytes: 1,
        idleSecondsAtCapture: 0,
      },
    ],
    batches: [],
    batchScreenshotLinks: [],
    observationMetadata: [],
    coverage: {
      requestedWindowSeconds: 600,
      screenshotCount: 1,
      linkedBatchCount: 0,
      observationMetadataCount: 0,
      firstCapturedAtEpochSecond: START_EPOCH_SECOND,
      lastCapturedAtEpochSecond: START_EPOCH_SECOND,
      observedSpanSeconds: 1,
      captureGapThresholdSeconds: 30,
      gaps: [
        {
          kind: "trailing",
          fromBoundaryEpochSecond: START_EPOCH_SECOND,
          toBoundaryEpochSecond: END_EPOCH_SECOND,
          elapsedSeconds: 599,
          expectedMaximumSeconds: 30,
        },
      ],
    },
    missingFields: [],
    issues: [
      {
        code: "OBSERVATION_TEXT_UNVERIFIED_EXCLUDED",
        severity: "warning",
        affectedRecordCount: 0,
      },
      {
        code: "SCREENSHOT_WITHOUT_ANALYSIS_BATCH",
        severity: "warning",
        affectedRecordCount: 1,
      },
      {
        code: "CAPTURE_GAP_DETECTED",
        severity: "warning",
        affectedRecordCount: 1,
      },
    ],
  };
  const payloadBytes = canonicalBytes(payload);
  const manifest = {
    schemaVersion: "dayflow.blabase-evidence-manifest.v1" as const,
    canonicalizationProfile:
      "foundation.sorted-keys.no-whitespace.integer-domain.v1" as const,
    exportRunId: EXPORT_RUN_ID,
    exporterVersion: "dayflow.blabase-evidence-exporter.v2" as const,
    payloadFile: "payload.json" as const,
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256: rawSha256(payloadBytes),
  };
  const manifestBytes = canonicalBytes(manifest);
  const manifestSha256Bytes = encoder.encode(rawSha256(manifestBytes));
  const sourceEntries = Object.freeze([
    sourceEntry("payload.json", payloadBytes),
    sourceEntry("manifest.json", manifestBytes),
    sourceEntry("manifest.sha256", manifestSha256Bytes),
    sourceEntry("COMPLETE", manifestSha256Bytes),
  ]);
  const imported = importDayflowMetadataEvidenceBundleV1({
    mode: "synthetic-task1-handoff",
    bundleDirectoryName: EXPORT_RUN_ID,
    entries: sourceEntries,
  });
  return Object.freeze({
    imported,
    copySourceEntries: () =>
      Object.freeze(
        sourceEntries.map((entry) => sourceEntry(
          entry.relativePath,
          entry.bytes,
        )),
      ),
  });
}

function structuredDescriptor(): StructuredCurrentWorkEvidenceDescriptorV1 {
  const asOf = new Date(END_EPOCH_SECOND * 1_000).toISOString();
  const payload = {
    schemaVersion:
      "blabase.dayflow-ablation.structured-current-work-evidence.v1" as const,
    sourceState: {
      managedCodex: "configured",
      github: "unconfigured",
      contextRegistry: "missing",
    },
    currentWorkEvidence: {
      asOf,
      githubBatch: null,
      contextRegistry: null,
    },
  };
  const canonicalJson = jcsCanonicalize(payload);
  return Object.freeze({
    schemaVersion: payload.schemaVersion,
    asOf,
    githubMode: "unconfigured" as const,
    canonicalJson,
    canonicalJsonByteLength: encoder.encode(canonicalJson).byteLength,
    sha256: domainSeparatedSha256(payload.schemaVersion, payload),
  });
}

function validInput(): BuildTask1EvaluationInputSealV1Input {
  return Object.freeze({
    window: Object.freeze({
      startEpochSecond: START_EPOCH_SECOND,
      endEpochSecond: END_EPOCH_SECOND,
    }),
    structured: structuredDescriptor(),
    dayflow: syntheticDayflowBundle(),
  });
}

function expectIssue(
  run: () => unknown,
  issueCode: Task1EvaluationInputSealErrorV1["issueCode"],
): void {
  try {
    run();
    throw new Error("Expected Task 1 evaluation input seal failure");
  } catch (error) {
    expect(error).toBeInstanceOf(Task1EvaluationInputSealErrorV1);
    expect((error as Task1EvaluationInputSealErrorV1).issueCode).toBe(
      issueCode,
    );
  }
}

describe("Task 1C evaluation input seal", () => {
  it("builds a deterministic, suggestion-free manifest and exact flat file set", () => {
    const first = buildTask1EvaluationInputSealV1(validInput());
    const second = buildTask1EvaluationInputSealV1(validInput());

    expect(first.descriptor.identitySha256).toBe(
      second.descriptor.identitySha256,
    );
    expect(first.descriptor.identitySha256).toBe(
      domainSeparatedSha256(
        TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
        first.manifest,
      ),
    );
    expect(first.manifest.schemaVersion).toBe(
      TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
    );
    expect(first.manifest.policy.policyId).toBe(TASK1C_POLICY_ID);
    expect(first.manifest.window).toEqual({
      startEpochSecond: START_EPOCH_SECOND,
      endEpochSecond: END_EPOCH_SECOND,
      durationSeconds: 600,
      semantics: "inclusive",
    });
    expect(first.manifest.dayflow.sourceFiles).toEqual([
      expect.objectContaining({
        sourceRelativePath: "payload.json",
        storedRelativePath: "dayflow-source-payload.json",
      }),
      expect.objectContaining({
        sourceRelativePath: "manifest.json",
        storedRelativePath: "dayflow-source-manifest.json",
      }),
      expect.objectContaining({
        sourceRelativePath: "manifest.sha256",
        storedRelativePath: "dayflow-source-manifest.sha256",
      }),
      expect.objectContaining({
        sourceRelativePath: "COMPLETE",
        storedRelativePath: "dayflow-source-COMPLETE",
      }),
    ]);

    const files = first.copyArtifactFiles();
    expect(files.map((file) => file.relativePath)).toEqual([
      "structured-evidence.json",
      "dayflow-source-payload.json",
      "dayflow-source-manifest.json",
      "dayflow-source-manifest.sha256",
      "dayflow-source-COMPLETE",
      "evaluation-input-manifest.json",
      "evaluation-input-manifest.sha256",
      "COMPLETE",
    ]);
    expect(decoder.decode(files[5]!.bytes)).toBe(
      `${jcsCanonicalize(first.manifest)}\n`,
    );
    expect(decoder.decode(files[6]!.bytes)).toBe(
      first.descriptor.identitySha256,
    );
    expect(decoder.decode(files[7]!.bytes)).toBe(
      first.descriptor.identitySha256,
    );
    expect(files[6]!.bytes.byteLength).toBe(64);
    expect(files[7]!.bytes.byteLength).toBe(64);

    const manifestText = JSON.stringify(first.manifest).toLowerCase();
    expect(manifestText).not.toContain("secret");
    expect(manifestText).not.toContain("prompt");
    expect(manifestText).not.toContain("model");
    expect(manifestText).not.toContain("suggestion");
    expect(manifestText).not.toContain("semanticoutput");
    expect(manifestText).not.toContain("screenshot");
    expect(manifestText).not.toContain("ocr");
  });

  it("keeps closure-owned bytes isolated from input and returned-copy mutation", () => {
    const input = validInput();
    const seal = buildTask1EvaluationInputSealV1(input);
    const expectedPayloadFirstByte = seal.copyArtifactFiles()[1]!.bytes[0];

    const firstCopy = seal.copyArtifactFiles();
    firstCopy[1]!.bytes[0] = 0;
    const secondCopy = seal.copyArtifactFiles();

    expect(secondCopy[1]!.bytes[0]).toBe(expectedPayloadFirstByte);
    expect(secondCopy[1]!.bytes).not.toBe(firstCopy[1]!.bytes);
  });

  it("rejects invalid windows and mismatched structured or Dayflow descriptors", () => {
    const input = validInput();
    expectIssue(
      () =>
        buildTask1EvaluationInputSealV1({
          ...input,
          window: {
            startEpochSecond: START_EPOCH_SECOND,
            endEpochSecond: END_EPOCH_SECOND + 1,
          },
        }),
      "WINDOW_INVALID",
    );
    expectIssue(
      () =>
        buildTask1EvaluationInputSealV1({
          ...input,
          structured: {
            ...input.structured,
            canonicalJsonByteLength:
              input.structured.canonicalJsonByteLength + 1,
          },
        }),
      "STRUCTURED_EVIDENCE_INVALID",
    );
    expectIssue(
      () =>
        buildTask1EvaluationInputSealV1({
          ...input,
          dayflow: {
            ...input.dayflow,
            imported: {
              ...input.dayflow.imported,
              descriptor: {
                ...input.dayflow.imported.descriptor,
                replayIdentitySha256: "0".repeat(64),
              },
            },
          },
        }),
      "DAYFLOW_DESCRIPTOR_MISMATCH",
    );
  });

  it("publishes COMPLETE last without clobber and verifies exact readback", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "blabase-task1c-seal-"));
    try {
      const seal = buildTask1EvaluationInputSealV1(validInput());
      const published = await publishTask1EvaluationInputSealV1({
        dataRoot,
        seal,
      });
      expect(published.relativeDirectory).toBe(
        `.local/dayflow-ablation/inputs/${TASK1C_POLICY_ID}/runs/${seal.descriptor.identitySha256}`,
      );
      expect(published.directoryMode).toBe(0o700);
      expect(published.files.map((file) => file.mode)).toEqual(
        new Array(8).fill(0o600),
      );
      await expect(
        verifyPublishedTask1EvaluationInputSealV1({ dataRoot, seal }),
      ).resolves.toEqual(published);
      await expect(
        publishTask1EvaluationInputSealV1({ dataRoot, seal }),
      ).rejects.toMatchObject({ issueCode: "PUBLICATION_FAILED" });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete pre-existing publication without repairing it", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "blabase-task1c-partial-"));
    try {
      const seal = buildTask1EvaluationInputSealV1(validInput());
      const runDirectory = join(
        dataRoot,
        ".local",
        "dayflow-ablation",
        "inputs",
        TASK1C_POLICY_ID,
        "runs",
        seal.descriptor.identitySha256,
      );
      await mkdir(runDirectory, { recursive: true, mode: 0o700 });
      await writeFile(
        join(runDirectory, "structured-evidence.json"),
        seal.copyArtifactFiles()[0]!.bytes,
        { mode: 0o600 },
      );

      await expect(
        verifyPublishedTask1EvaluationInputSealV1({ dataRoot, seal }),
      ).rejects.toMatchObject({ issueCode: "VERIFICATION_FAILED" });
      await expect(
        publishTask1EvaluationInputSealV1({ dataRoot, seal }),
      ).rejects.toMatchObject({ issueCode: "PUBLICATION_FAILED" });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
