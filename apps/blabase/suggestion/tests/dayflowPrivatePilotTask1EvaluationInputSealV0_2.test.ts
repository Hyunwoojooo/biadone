import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../src/dayflowEvidence/contracts";
import {
  canonicalJsonLfBytes,
  rawSha256,
} from "../src/evaluation/privateArtifactStore";
import type { StructuredCurrentWorkEvidenceDescriptorV1 } from "../src/evaluation/dayflowAblation/captureStructuredCurrentWorkEvidenceV1";
import {
  buildPrivatePilotTask1EvaluationInputSealV0_2,
  PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION,
  PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
  PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
  PRIVATE_PILOT_TASK1_POLICY_ID,
  PRIVATE_PILOT_TASK1_POLICY_SCHEMA_VERSION,
  PRIVATE_PILOT_TASK1_POLICY_SHA256,
  PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION,
  PrivatePilotTask1EvaluationInputSealErrorV0_2,
  publishPrivatePilotTask1EvaluationInputSealV0_2,
  verifyPublishedPrivatePilotTask1EvaluationInputSealV0_2,
} from "../src/evaluation/dayflowAblation/sealPrivatePilotTask1EvaluationInputV0_2";
import type {
  BuildPrivatePilotTask1EvaluationInputSealV0_2Input,
  PrivatePilotTask1AuthorizationBindingV0_2,
  PrivatePilotTask1RealReaderBindingV0_2,
  PrivatePilotTask1SourceEntryV0_2,
} from "../src/evaluation/dayflowAblation/sealPrivatePilotTask1EvaluationInputV0_2";
import {
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_INVARIANT_V0_2,
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
} from "../src/evaluation/dayflowAblation/task1PrivatePilotArtifactBudgetV0_2";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const START = 1_900_000_000;
const END = START + 599;
const AS_OF = new Date(END * 1_000).toISOString();
const AUTHORIZED_AT_SECOND = START - 60;
const AUTHORIZED_AT = new Date(AUTHORIZED_AT_SECOND * 1_000).toISOString();
const EXPORT_RUN_ID = "private-pilot-task1-window-001";
const EPISODE_ID = "episode-private-pilot-001";
const AUTH_DOMAIN =
  "blabase.dayflow-ablation.task1-private-pilot-authorization.v0.1";
const QUALIFICATION_VERSION =
  "blabase.dayflow-metadata-evidence-private-pilot-qualification.v1";

function file(
  relativePath: string,
  mediaType: string,
  bytes: Uint8Array,
) {
  const copy = new Uint8Array(bytes);
  return Object.freeze({
    relativePath,
    mediaType,
    byteLength: copy.byteLength,
    rawSha256: rawSha256(copy),
    bytes: copy,
  });
}

function authorizationBinding(): PrivatePilotTask1AuthorizationBindingV0_2 {
  const authorization = {
    schemaVersion: PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION,
    authorization: {
      authorizedBy: "colin",
      decision: "authorized",
      sourceMode: "real-private-pilot",
      episodeId: EPISODE_ID,
      workspaceIdentitySha256: "1".repeat(64),
      authorizedAtEpochSecond: AUTHORIZED_AT_SECOND,
      authorizedAt: AUTHORIZED_AT,
      expectedExportRunId: EXPORT_RUN_ID,
    },
    policy: {
      schemaVersion: PRIVATE_PILOT_TASK1_POLICY_SCHEMA_VERSION,
      policyId: PRIVATE_PILOT_TASK1_POLICY_ID,
      sha256: PRIVATE_PILOT_TASK1_POLICY_SHA256,
    },
    window: {
      startEpochSecond: START,
      endEpochSecond: END,
      durationSeconds: 600,
      semantics: "inclusive",
      asOf: AS_OF,
    },
    handling: { storage: "private-local-only" },
    structuredEvidence: {
      authority: "preserved-current-work-evidence-at-window-end",
    },
    privacy: {
      profile: "metadata-only.v1",
      observationText: "excluded-unverified",
      screenshotBytes: "excluded",
    },
    quality: { manualRepair: "forbidden" },
    retention: {
      action: "delete",
      incompleteStagingSeconds: 3_600,
      dayflowRawMaximumSeconds: 86_400,
      sealedPrivateInputMaximumSeconds: 2_592_000,
    },
    failurePolicy: { wholeWindowReject: true },
    canonicalization: { profile: "rfc8785-jcs.utf8.lf.v1" },
  } as const;
  const authorizationBytes = canonicalJsonLfBytes(authorization);
  const identitySha256 = domainSeparatedSha256(AUTH_DOMAIN, authorization);
  const identityBytes = encoder.encode(identitySha256);
  return Object.freeze({
    descriptor: Object.freeze({
      schemaVersion: PRIVATE_PILOT_TASK1_AUTHORIZATION_SCHEMA_VERSION,
      identityHashDomain: AUTH_DOMAIN,
      identitySha256,
      authorizationByteLength: authorizationBytes.byteLength,
      authorizationRawSha256: rawSha256(authorizationBytes),
      episodeId: EPISODE_ID,
      sourceMode: "real-private-pilot" as const,
      expectedExportRunId: EXPORT_RUN_ID,
      startEpochSecond: START,
      endEpochSecond: END,
      asOf: AS_OF,
    }),
    authorization,
    copyArtifactFiles: () =>
      Object.freeze([
        file("authorization.json", "application/json", authorizationBytes),
        file(
          "authorization.sha256",
          "text/plain; charset=us-ascii",
          identityBytes,
        ),
        file("COMPLETE", "text/plain; charset=us-ascii", identityBytes),
      ]),
  });
}

function structuredDescriptor(): StructuredCurrentWorkEvidenceDescriptorV1 {
  const payload = {
    schemaVersion:
      "blabase.dayflow-ablation.structured-current-work-evidence.v1" as const,
    sourceState: {
      managedCodex: "configured",
      github: "unconfigured",
      contextRegistry: "missing",
    },
    currentWorkEvidence: { asOf: AS_OF, githubBatch: null },
  };
  const canonicalJson = jcsCanonicalize(payload);
  return Object.freeze({
    schemaVersion: payload.schemaVersion,
    asOf: AS_OF,
    githubMode: "unconfigured" as const,
    canonicalJson,
    canonicalJsonByteLength: encoder.encode(canonicalJson).byteLength,
    sha256: domainSeparatedSha256(payload.schemaVersion, payload),
  });
}

function sourceEntry(
  relativePath: string,
  bytes: Uint8Array,
): PrivatePilotTask1SourceEntryV0_2 {
  return Object.freeze({
    relativePath,
    entryKind: "regular-file" as const,
    byteLength: bytes.byteLength,
    bytes: new Uint8Array(bytes),
  });
}

function realReader(
  mutate?: (entries: PrivatePilotTask1SourceEntryV0_2[]) => void,
): PrivatePilotTask1RealReaderBindingV0_2 {
  const payload = {
    schemaVersion: "dayflow.blabase-evidence-bundle.v1",
    exportRunId: EXPORT_RUN_ID,
    window: { startEpochSecond: START, endEpochSecond: END },
  };
  const payloadBytes = encoder.encode(jcsCanonicalize(payload));
  const manifest = {
    schemaVersion: "dayflow.blabase-evidence-manifest.v1",
    exportRunId: EXPORT_RUN_ID,
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256: rawSha256(payloadBytes),
  };
  const manifestBytes = encoder.encode(jcsCanonicalize(manifest));
  const manifestSha256 = rawSha256(manifestBytes);
  const markerBytes = encoder.encode(manifestSha256);
  const baseEntries = [
    sourceEntry("payload.json", payloadBytes),
    sourceEntry("manifest.json", manifestBytes),
    sourceEntry("manifest.sha256", markerBytes),
    sourceEntry("COMPLETE", markerBytes),
  ];
  const captureBinding = {
    schemaVersion: "blabase.dayflow-private-pilot-capture-binding.v1",
    pilotId: "pilot-001",
    authorizationId: authorizationBinding().descriptor.identitySha256,
    policySha256: PRIVATE_PILOT_TASK1_POLICY_SHA256,
    expectedExportRunId: EXPORT_RUN_ID,
    window: { startEpochSecond: START, endEpochSecond: END },
  };
  const descriptor = {
    qualificationSchemaVersion: QUALIFICATION_VERSION,
    exportRunId: EXPORT_RUN_ID,
    manifestByteCount: manifestBytes.byteLength,
    manifestSha256,
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256: rawSha256(payloadBytes),
    replayIdentitySha256: domainSeparatedSha256(
      "blabase.dayflow-private-pilot-replay.v1",
      { exportRunId: EXPORT_RUN_ID, manifestSha256 },
    ),
  };
  return Object.freeze({
    sourceDescriptor: Object.freeze({
      readSchemaVersion: PRIVATE_PILOT_TASK1_REAL_READ_SCHEMA_VERSION,
      sourceMode: "real-private-pilot" as const,
      bundleDirectoryName: EXPORT_RUN_ID,
      sourceOrder: Object.freeze([
        "payload.json",
        "manifest.json",
        "manifest.sha256",
        "COMPLETE",
      ]),
      captureBinding: Object.freeze(captureBinding),
      captureBindingSha256: domainSeparatedSha256(
        "blabase.dayflow-private-pilot-capture-binding.v1",
        captureBinding,
      ),
      wireProvenance: Object.freeze({
        sourceSystem: "dayflow.sqlite",
        privacyProfile: "metadata-only.v1",
      }),
    }),
    qualified: Object.freeze({
      descriptor: Object.freeze(descriptor),
      manifest: Object.freeze(manifest),
      evidence: Object.freeze({
        window: Object.freeze({
          startEpochSecond: START,
          endEpochSecond: END,
        }),
      }),
    }),
    sourceFiles: Object.freeze(
      baseEntries.map((entry) =>
        Object.freeze({
          relativePath: entry.relativePath,
          entryKind: "regular-file" as const,
          byteLength: entry.byteLength,
          rawSha256: rawSha256(entry.bytes),
        }),
      ),
    ),
    copySourceEntries: () => {
      const entries = baseEntries.map((entry) =>
        sourceEntry(entry.relativePath, entry.bytes),
      );
      mutate?.(entries);
      return Object.freeze(entries);
    },
  });
}

function validInput(): BuildPrivatePilotTask1EvaluationInputSealV0_2Input {
  return Object.freeze({
    authorization: authorizationBinding(),
    structured: structuredDescriptor(),
    dayflow: realReader(),
  });
}

function structuredDescriptorAtByteLength(
  targetByteLength: number,
): StructuredCurrentWorkEvidenceDescriptorV1 {
  const base = structuredDescriptor();
  const parsed = JSON.parse(base.canonicalJson) as Record<string, unknown>;
  const baseByteLength = encoder.encode(jcsCanonicalize(parsed)).byteLength;
  const paddingLength = targetByteLength - baseByteLength;
  if (paddingLength < 0) {
    throw new Error("Target structured evidence budget is too small");
  }

  function padExistingString(
    value: unknown,
  ): Readonly<{ value: unknown; changed: boolean }> {
    if (typeof value === "string") {
      return Object.freeze({
        value: `${value}${"x".repeat(paddingLength)}`,
        changed: true,
      });
    }
    if (Array.isArray(value)) {
      const copy = [...value];
      for (let index = 0; index < copy.length; index += 1) {
        const padded = padExistingString(copy[index]);
        if (padded.changed) {
          copy[index] = padded.value;
          return Object.freeze({ value: copy, changed: true });
        }
      }
      return Object.freeze({ value: copy, changed: false });
    }
    if (value !== null && typeof value === "object") {
      const source = value as Record<string, unknown>;
      const copy: Record<string, unknown> = { ...source };
      const preferredKeys = ["text", "summary", "title", "description"];
      const keys = [
        ...preferredKeys.filter((key) => key in source),
        ...Object.keys(source).filter((key) => !preferredKeys.includes(key)),
      ];
      for (const key of keys) {
        const padded = padExistingString(source[key]);
        if (padded.changed) {
          copy[key] = padded.value;
          return Object.freeze({ value: copy, changed: true });
        }
      }
      return Object.freeze({ value: copy, changed: false });
    }
    return Object.freeze({ value, changed: false });
  }

  const paddedCurrentWorkEvidence = padExistingString(
    parsed.currentWorkEvidence,
  );
  if (!paddedCurrentWorkEvidence.changed) {
    throw new Error("Structured evidence fixture has no existing text value");
  }
  const record = {
    ...parsed,
    currentWorkEvidence: paddedCurrentWorkEvidence.value,
  };
  const canonicalJson = jcsCanonicalize(record);
  const canonicalJsonByteLength = encoder.encode(canonicalJson).byteLength;
  if (canonicalJsonByteLength !== targetByteLength) {
    throw new Error("Structured evidence budget fixture length mismatch");
  }
  return Object.freeze({
    ...base,
    canonicalJson,
    canonicalJsonByteLength,
    sha256: domainSeparatedSha256(base.schemaVersion, record),
  });
}

function expectIssue(
  run: () => unknown,
  issueCode: PrivatePilotTask1EvaluationInputSealErrorV0_2["issueCode"],
): void {
  try {
    run();
    throw new Error("Expected private-pilot seal failure");
  } catch (error) {
    expect(error).toBeInstanceOf(
      PrivatePilotTask1EvaluationInputSealErrorV0_2,
    );
    expect(
      (error as PrivatePilotTask1EvaluationInputSealErrorV0_2).issueCode,
    ).toBe(issueCode);
  }
}

describe("private-pilot Task 1 evaluation input V0.2", () => {
  it("builds the real-only V0.2 manifest and exact ten-file seal", () => {
    const seal = buildPrivatePilotTask1EvaluationInputSealV0_2(validInput());
    expect(seal.manifest.schemaVersion).toBe(
      PRIVATE_PILOT_TASK1_EVALUATION_INPUT_MANIFEST_SCHEMA_VERSION,
    );
    expect(seal.manifest.sourceMode).toBe("real-private-pilot");
    expect(seal.descriptor.identitySha256).toBe(
      domainSeparatedSha256(
        PRIVATE_PILOT_TASK1_EVALUATION_INPUT_IDENTITY_HASH_DOMAIN,
        seal.manifest,
      ),
    );
    expect(
      domainSeparatedSha256(
        "blabase.dayflow-ablation.task1-evaluation-input.v0.1",
        seal.manifest,
      ),
    ).not.toBe(seal.descriptor.identitySha256);
    const files = seal.copyArtifactFiles();
    expect(files.map((entry) => entry.relativePath)).toEqual([
      "authorization.json",
      "authorization.sha256",
      "structured-evidence.json",
      "dayflow-source-payload.json",
      "dayflow-source-manifest.json",
      "dayflow-source-manifest.sha256",
      "dayflow-source-COMPLETE",
      "evaluation-input-manifest.json",
      "evaluation-input-manifest.sha256",
      "COMPLETE",
    ]);
    expect(decoder.decode(files[7]!.bytes)).toBe(
      `${jcsCanonicalize(seal.manifest)}\n`,
    );
    expect(decoder.decode(files[8]!.bytes)).toBe(
      seal.descriptor.identitySha256,
    );
    expect(decoder.decode(files[9]!.bytes)).toBe(
      seal.descriptor.identitySha256,
    );
  });

  it("uses the frozen exact-file budget and stays within the aggregate cap", () => {
    expect(TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_INVARIANT_V0_2).toEqual({
      fileCount: 10,
      derivedTotalBytes: 5_226_816,
      declaredTotalBytes: 5_226_816,
      matchesDeclaredTotal: true,
    });
    const files =
      buildPrivatePilotTask1EvaluationInputSealV0_2(validInput()).copyArtifactFiles();
    let aggregateBytes = 0;
    for (const file of files) {
      const maximumBytes =
        TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2[
          file.relativePath as keyof typeof TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2
        ];
      expect(maximumBytes).toBeTypeOf("number");
      expect(file.byteLength).toBeLessThanOrEqual(maximumBytes);
      aggregateBytes += file.byteLength;
    }
    expect(aggregateBytes).toBeLessThanOrEqual(
      TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
    );
  });

  it("rejects structured evidence above the artifact safety ceiling", () => {
    const maximumBytes =
      TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2["structured-evidence.json"];
    expectIssue(
      () =>
        buildPrivatePilotTask1EvaluationInputSealV0_2({
          ...validInput(),
          structured: structuredDescriptorAtByteLength(maximumBytes + 1),
        }),
      "STRUCTURED_EVIDENCE_INVALID",
    );
  });

  it("rejects synthetic mode and authorization/window mismatches", () => {
    const input = validInput();
    expectIssue(
      () =>
        buildPrivatePilotTask1EvaluationInputSealV0_2({
          ...input,
          dayflow: {
            ...input.dayflow,
            sourceDescriptor: {
              ...input.dayflow.sourceDescriptor,
              sourceMode: "synthetic-task1-handoff" as never,
            },
          },
        }),
      "SOURCE_MODE_MISMATCH",
    );
    expectIssue(
      () =>
        buildPrivatePilotTask1EvaluationInputSealV0_2({
          ...input,
          structured: { ...input.structured, asOf: new Date((END - 1) * 1_000).toISOString() },
        }),
      "STRUCTURED_EVIDENCE_INVALID",
    );
  });

  it("rejects source mutation and qualification descriptor mismatch", () => {
    const input = validInput();
    expectIssue(
      () =>
        buildPrivatePilotTask1EvaluationInputSealV0_2({
          ...input,
          dayflow: realReader((entries) => {
            entries[0]!.bytes[0] = entries[0]!.bytes[0]! ^ 1;
          }),
        }),
      "DAYFLOW_SOURCE_INVALID",
    );
    expectIssue(
      () =>
        buildPrivatePilotTask1EvaluationInputSealV0_2({
          ...input,
          dayflow: {
            ...input.dayflow,
            qualified: {
              ...input.dayflow.qualified,
              descriptor: {
                ...input.dayflow.qualified.descriptor,
                manifestSha256: "0".repeat(64),
              },
            },
          },
        }),
      "DAYFLOW_QUALIFICATION_INVALID",
    );
  });

  it("publishes no-clobber and verifies only the same-process seal", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "blabase-private-pilot-v02-"));
    try {
      const seal = buildPrivatePilotTask1EvaluationInputSealV0_2(validInput());
      const published = await publishPrivatePilotTask1EvaluationInputSealV0_2({
        dataRoot,
        seal,
      });
      expect(published.files).toHaveLength(10);
      await expect(
        verifyPublishedPrivatePilotTask1EvaluationInputSealV0_2({
          dataRoot,
          seal,
        }),
      ).resolves.toEqual(published);
      await expect(
        publishPrivatePilotTask1EvaluationInputSealV0_2({ dataRoot, seal }),
      ).rejects.toMatchObject({ issueCode: "PUBLICATION_FAILED" });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("rejects a partial publication without repair or overwrite", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "blabase-private-pilot-partial-"));
    try {
      const seal = buildPrivatePilotTask1EvaluationInputSealV0_2(validInput());
      const runDirectory = join(
        dataRoot,
        ".local",
        "dayflow-ablation",
        "inputs",
        PRIVATE_PILOT_TASK1_POLICY_ID,
        "runs",
        seal.descriptor.identitySha256,
      );
      await mkdir(runDirectory, { recursive: true, mode: 0o700 });
      await writeFile(
        join(runDirectory, "authorization.json"),
        seal.copyArtifactFiles()[0]!.bytes,
        { mode: 0o600 },
      );
      await expect(
        verifyPublishedPrivatePilotTask1EvaluationInputSealV0_2({
          dataRoot,
          seal,
        }),
      ).rejects.toMatchObject({ issueCode: "VERIFICATION_FAILED" });
      await expect(
        publishPrivatePilotTask1EvaluationInputSealV0_2({ dataRoot, seal }),
      ).rejects.toMatchObject({ issueCode: "PUBLICATION_FAILED" });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
