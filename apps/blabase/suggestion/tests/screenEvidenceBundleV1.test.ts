import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCREEN_EVIDENCE_BUNDLE_FILES_V1,
  SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
  SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
  SCREEN_EVIDENCE_LIMITS_V1,
  SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
  SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
  SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
  type ScreenEvidenceBundleInputV1,
} from "../src/screenEvidence/contractsV1";
import {
  importScreenEvidenceBundleV1,
  ScreenEvidenceImportErrorV1,
} from "../src/screenEvidence/importScreenEvidenceBundleV1";
import {
  readScreenEvidenceBundleV1,
  ScreenEvidenceReadErrorV1,
} from "../src/screenEvidence/readScreenEvidenceBundleV1";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
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

interface BundleOptions {
  bundleDirectoryName?: string;
  completionMarker?: string;
  manifestBytes?: Uint8Array;
  manifestMarker?: string;
  manifestOverrides?: JsonObject;
  payloadBytes?: Uint8Array;
}

const encoder = new TextEncoder();
const temporaryRoots = new Set<string>();

afterEach(async () => {
  const roots = [...temporaryRoots];
  temporaryRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  const canonical: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    canonical[key] = canonicalValue(value[key]!);
  }
  return canonical;
}

function canonicalText(value: JsonValue): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalBytes(value: JsonValue): Uint8Array {
  return encoder.encode(canonicalText(value));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function replayIdentitySha256(
  manifestBytes: Uint8Array,
  payloadBytes: Uint8Array,
): string {
  const hash = createHash("sha256");
  hash.update(encoder.encode("blabase.screen-evidence-replay.v1\0"));
  for (const part of [manifestBytes, payloadBytes]) {
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(part.byteLength), false);
    hash.update(length);
    hash.update(part);
  }
  return hash.digest("hex");
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function concatenateBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((byteCount, part) => byteCount + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function validPayload(): JsonObject {
  return {
    schemaVersion: SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1,
    producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
    preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
    exportRunId: "screen-evidence-test-run",
    window: {
      startEpochMs: 1_000,
      endEpochMs: 2_000,
    },
    provenance: {
      sourceSystem: "blabase.capture-store.v1",
      sourceRevision: "fixture-revision-1",
      preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
      privacyProfile: "blabase.privacy-minimized-screen-evidence.v1",
    },
    captures: [
      {
        captureId: "capture-a",
        revision: 1,
        capturedAtEpochMs: 1_000,
      },
      {
        captureId: "capture-b",
        revision: 2,
        capturedAtEpochMs: 2_000,
      },
    ],
    observations: [
      {
        observationId: "observation-a",
        captureId: "capture-a",
        capturedAtEpochMs: 1_000,
        kind: "ocr_span",
        text: "Synthetic task context",
        confidence: 0.9,
      },
      {
        observationId: "observation-b",
        captureId: "capture-b",
        capturedAtEpochMs: 2_000,
        kind: "application",
        label: "Synthetic editor",
        confidence: 0.8,
      },
    ],
    coverage: {
      captureCount: 2,
      observationCount: 2,
      ocrSpanCount: 1,
      coveredCaptureCount: 2,
      coveredCaptureRatio: 1,
    },
    conflicts: [],
    issues: [],
  };
}

function buildBundle(
  payload: JsonObject = validPayload(),
  options: BundleOptions = {},
): MutableBundle {
  const payloadBytes = options.payloadBytes?.slice() ?? canonicalBytes(payload);
  const payloadSha256 = sha256(payloadBytes);
  const manifest: JsonObject = {
    schemaVersion: SCREEN_EVIDENCE_MANIFEST_SCHEMA_V1,
    canonicalizationProfile: SCREEN_EVIDENCE_CANONICALIZATION_PROFILE_V1,
    producerIdentity: SCREEN_EVIDENCE_PRODUCER_IDENTITY_V1,
    preprocessingVersion: SCREEN_EVIDENCE_PREPROCESSING_VERSION_V1,
    exportRunId: String(payload.exportRunId),
    payloadFile: "payload.json",
    payloadByteCount: payloadBytes.byteLength,
    payloadSha256,
  };
  if (options.manifestOverrides !== undefined) {
    for (const [key, value] of Object.entries(options.manifestOverrides)) {
      manifest[key] = value;
    }
  }
  const manifestBytes = options.manifestBytes?.slice() ?? canonicalBytes(manifest);
  const manifestSha256 = sha256(manifestBytes);
  const manifestMarker = encoder.encode(
    options.manifestMarker ?? manifestSha256,
  );
  const completionMarker = encoder.encode(
    options.completionMarker ?? manifestSha256,
  );

  return {
    bundleDirectoryName:
      options.bundleDirectoryName ?? String(manifest.exportRunId),
    entries: [
      entry("payload.json", payloadBytes),
      entry("manifest.json", manifestBytes),
      entry("manifest.sha256", manifestMarker),
      entry("COMPLETE", completionMarker),
    ],
  };
}

function entry(relativePath: string, bytes: Uint8Array): MutableBundleEntry {
  return {
    relativePath,
    entryKind: "regular-file",
    byteLength: bytes.byteLength,
    bytes,
  };
}

function bundleEntry(
  bundle: MutableBundle,
  relativePath: string,
): MutableBundleEntry {
  const result = bundle.entries.find((candidate) => candidate.relativePath === relativePath);
  if (result === undefined) throw new Error(`Missing test entry: ${relativePath}`);
  return result;
}

function cloneBundle(bundle: MutableBundle): MutableBundle {
  return {
    bundleDirectoryName: bundle.bundleDirectoryName,
    entries: bundle.entries.map((candidate) => ({
      ...candidate,
      bytes: candidate.bytes.slice(),
    })),
  };
}

function importFixture(bundle: MutableBundle) {
  return importScreenEvidenceBundleV1(
    bundle as unknown as ScreenEvidenceBundleInputV1,
  );
}

function expectImportIssue(bundle: MutableBundle, expectedIssueCode: string): void {
  let caught: unknown;
  try {
    importFixture(bundle);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ScreenEvidenceImportErrorV1);
  expect((caught as ScreenEvidenceImportErrorV1).issueCode).toBe(expectedIssueCode);
}

async function expectReadIssue(
  bundleDirectory: string,
  expectedIssueCode: string,
): Promise<void> {
  let caught: unknown;
  try {
    await readScreenEvidenceBundleV1({ bundleDirectory });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ScreenEvidenceReadErrorV1);
  expect((caught as ScreenEvidenceReadErrorV1).issueCode).toBe(expectedIssueCode);
}

function expectDeeplyFrozen(value: unknown, visited = new Set<object>()): void {
  if (value === null || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, visited);
}

function objectArray(payload: JsonObject, key: string): JsonObject[] {
  return payload[key] as JsonObject[];
}

function objectField(payload: JsonObject, key: string): JsonObject {
  return payload[key] as JsonObject;
}

async function writePrivateBundle(bundle: MutableBundle): Promise<{
  bundleDirectory: string;
  root: string;
}> {
  const canonicalTemporaryDirectory = await realpath(tmpdir());
  const root = await mkdtemp(
    path.join(canonicalTemporaryDirectory, "blabase-screen-evidence-test-"),
  );
  temporaryRoots.add(root);
  await chmod(root, 0o700);
  const bundleDirectory = path.join(root, bundle.bundleDirectoryName);
  await mkdir(bundleDirectory, { mode: 0o700 });
  await chmod(bundleDirectory, 0o700);
  for (const candidate of bundle.entries) {
    const absolutePath = path.join(bundleDirectory, candidate.relativePath);
    await writeFile(absolutePath, candidate.bytes, { mode: 0o600 });
    await chmod(absolutePath, 0o600);
  }
  return { bundleDirectory, root };
}

describe("screen evidence bundle V1 import", () => {
  it("imports a canonical four-file bundle deterministically into owned frozen data", () => {
    const bundle = buildBundle();
    const independentInput = cloneBundle(bundle);
    const payloadBytes = bundleEntry(bundle, "payload.json").bytes.slice();
    const manifestBytes = bundleEntry(bundle, "manifest.json").bytes.slice();

    const first = importFixture(bundle);
    const second = importFixture(independentInput);

    expect(first).toEqual(second);
    expect(first.descriptor).toMatchObject({
      qualificationSchemaVersion: "blabase.screen-evidence-qualification.v1",
      importSchemaVersion: "blabase.screen-evidence-import.v1",
      exportRunId: "screen-evidence-test-run",
      manifestByteCount: manifestBytes.byteLength,
      manifestSha256: sha256(manifestBytes),
      payloadByteCount: payloadBytes.byteLength,
      payloadSha256: sha256(payloadBytes),
      replayIdentitySha256: replayIdentitySha256(manifestBytes, payloadBytes),
    });
    expect(first.evidence.captures.map((capture) => capture.captureId)).toEqual([
      "capture-a",
      "capture-b",
    ]);
    expectDeeplyFrozen(first);

    const replayHash = first.descriptor.replayIdentitySha256;
    bundleEntry(bundle, "payload.json").bytes.fill(0);
    bundleEntry(bundle, "manifest.json").bytes.fill(0);
    bundle.bundleDirectoryName = "mutated-after-import";

    expect(first.evidence.exportRunId).toBe("screen-evidence-test-run");
    expect(first.evidence.observations[0]).toMatchObject({
      kind: "ocr_span",
      text: "Synthetic task context",
    });
    expect(first.descriptor.replayIdentitySha256).toBe(replayHash);
  });

  it.each([
    ["legacy payload schema", "payload", "schemaVersion", "dayflow.metadata-evidence-bundle.v2", "PAYLOAD_INVALID"],
    ["legacy manifest schema", "manifest", "schemaVersion", "dayflow.metadata-evidence-manifest.v2", "MANIFEST_INVALID"],
    ["legacy producer identity", "both", "producerIdentity", "dayflow.blabase-evidence-exporter.v2", "MANIFEST_INVALID"],
  ] as const)("rejects %s", (_name, target, key, value, expectedIssueCode) => {
    const payload = validPayload();
    const manifestOverrides: JsonObject = {};
    if (target === "payload" || target === "both") payload[key] = value;
    if (target === "manifest" || target === "both") manifestOverrides[key] = value;
    expectImportIssue(
      buildBundle(payload, { manifestOverrides }),
      expectedIssueCode,
    );
  });

  it.each([
    ["UTF-8 BOM", (payload: JsonObject) => concatenateBytes(new Uint8Array([0xef, 0xbb, 0xbf]), canonicalBytes(payload)), "JSON_INVALID"],
    ["invalid UTF-8", () => new Uint8Array([0xff]), "JSON_INVALID"],
    ["leading whitespace", (payload: JsonObject) => encoder.encode(` ${canonicalText(payload)}`), "PAYLOAD_INVALID"],
    ["trailing newline", (payload: JsonObject) => encoder.encode(`${canonicalText(payload)}\n`), "PAYLOAD_INVALID"],
    ["noncanonical key order", (payload: JsonObject) => encoder.encode(JSON.stringify(payload)), "PAYLOAD_INVALID"],
    ["a duplicate decoded key", (payload: JsonObject) => {
      const canonical = canonicalText(payload);
      return encoder.encode(
        `${canonical.slice(0, -1)},"schema\\u0056ersion":"${SCREEN_EVIDENCE_BUNDLE_SCHEMA_V1}"}`,
      );
    }, "JSON_DUPLICATE_KEY"],
  ] as const)("rejects %s", (_name, payloadWire, expectedIssueCode) => {
    const payload = validPayload();
    expectImportIssue(
      buildBundle(payload, { payloadBytes: payloadWire(payload) }),
      expectedIssueCode,
    );
  });

  it("rejects payload, manifest, hash marker, completion marker, and run binding mismatches", () => {
    const payloadMutation = buildBundle();
    bundleEntry(payloadMutation, "payload.json").bytes[0] ^= 1;
    expectImportIssue(payloadMutation, "HASH_BINDING_MISMATCH");

    expectImportIssue(
      buildBundle(validPayload(), {
        manifestOverrides: { payloadSha256: "0".repeat(64) },
      }),
      "HASH_BINDING_MISMATCH",
    );
    expectImportIssue(
      buildBundle(validPayload(), { manifestMarker: "0".repeat(64) }),
      "MARKER_INVALID",
    );
    expectImportIssue(
      buildBundle(validPayload(), { completionMarker: "0".repeat(64) }),
      "MARKER_INVALID",
    );

    const mismatchedRun = validPayload();
    mismatchedRun.exportRunId = "payload-run";
    expectImportIssue(
      buildBundle(mismatchedRun, {
        bundleDirectoryName: "manifest-run",
        manifestOverrides: { exportRunId: "manifest-run" },
      }),
      "HASH_BINDING_MISMATCH",
    );
  });

  it("rejects missing and extra entries", () => {
    const missing = buildBundle();
    missing.entries = missing.entries.filter(
      (candidate) => candidate.relativePath !== "COMPLETE",
    );
    expectImportIssue(missing, "BUNDLE_INCOMPLETE");

    const extra = buildBundle();
    extra.entries.push(entry("extra.json", encoder.encode("{}")));
    expectImportIssue(extra, "BUNDLE_INPUT_INVALID");
  });
});

describe("screen evidence bundle V1 privacy boundary", () => {
  it.each([
    "title",
    "summary",
    "semanticOutput",
    "ranking",
    "caveat",
    "rawScreenshot",
    "screenshotPath",
    "credentials",
    "metadata",
  ] as const)("rejects the forbidden field %s", (key) => {
    const payload = validPayload();
    payload[key] = "redacted synthetic value";
    expectImportIssue(buildBundle(payload), "FORBIDDEN_FIELD");
  });

  it.each([
    "RECENT_FOCUS",
    "VISIBLE_TASK_INTENT",
    "semanticOutput",
    "/items/synthetic/title",
  ] as const)("rejects the forbidden token %s", (token) => {
    const payload = validPayload();
    objectArray(payload, "observations")[0]!.text = token;
    expectImportIssue(buildBundle(payload), "FORBIDDEN_TOKEN");
  });
});

describe("screen evidence bundle V1 semantic invariants", () => {
  type Mutation = (payload: JsonObject) => void;
  const invariantCases: readonly [string, string, Mutation][] = [
    [
      "capture canonical order",
      "ORDER_INVALID",
      (payload) => objectArray(payload, "captures").reverse(),
    ],
    [
      "observation canonical order",
      "ORDER_INVALID",
      (payload) => objectArray(payload, "observations").reverse(),
    ],
    [
      "unique capture ids",
      "REFERENCE_INVALID",
      (payload) => {
        objectArray(payload, "captures")[1]!.captureId = "capture-a";
      },
    ],
    [
      "unique observation ids",
      "REFERENCE_INVALID",
      (payload) => {
        objectArray(payload, "observations")[1]!.observationId = "observation-a";
      },
    ],
    [
      "observation capture references",
      "REFERENCE_INVALID",
      (payload) => {
        objectArray(payload, "observations")[0]!.captureId = "missing-capture";
      },
    ],
    [
      "observation timestamps matching captures",
      "REFERENCE_INVALID",
      (payload) => {
        objectArray(payload, "observations")[0]!.capturedAtEpochMs = 1_001;
      },
    ],
    [
      "capture window inclusion",
      "REFERENCE_INVALID",
      (payload) => {
        objectArray(payload, "captures")[0]!.capturedAtEpochMs = 999;
      },
    ],
    [
      "a non-reversed window",
      "COVERAGE_INVALID",
      (payload) => {
        objectField(payload, "window").startEpochMs = 2_001;
      },
    ],
    [
      "positive revisions",
      "PAYLOAD_INVALID",
      (payload) => {
        objectArray(payload, "captures")[0]!.revision = 0;
      },
    ],
    [
      "bounded confidence",
      "PAYLOAD_INVALID",
      (payload) => {
        objectArray(payload, "observations")[0]!.confidence = 1.01;
      },
    ],
    [
      "exact coverage counts",
      "COVERAGE_INVALID",
      (payload) => {
        objectField(payload, "coverage").observationCount = 1;
      },
    ],
    [
      "OCR text without a label",
      "PAYLOAD_INVALID",
      (payload) => {
        objectArray(payload, "observations")[0]!.label = "not allowed";
      },
    ],
    [
      "label observations without OCR text",
      "PAYLOAD_INVALID",
      (payload) => {
        const observation = objectArray(payload, "observations")[1]!;
        delete observation.label;
        observation.text = "not allowed";
      },
    ],
  ];

  it.each(invariantCases)("enforces %s", (_name, expectedIssueCode, mutate) => {
    const payload = validPayload();
    mutate(payload);
    expectImportIssue(buildBundle(payload), expectedIssueCode);
  });

  it("accepts closed conflict and issue references and rejects open or duplicate references", () => {
    const closed = validPayload();
    closed.conflicts = [
      {
        code: "OBSERVATION_CAPTURE_CONFLICT",
        observationId: "observation-a",
        captureId: "capture-a",
      },
    ];
    closed.issues = [
      {
        code: "OBSERVATION_LOW_CONFIDENCE",
        observationId: "observation-a",
        captureId: "capture-a",
      },
      {
        code: "CAPTURE_GAP",
        beforeCaptureId: "capture-a",
        afterCaptureId: "capture-b",
      },
    ];
    expect(() => importFixture(buildBundle(closed))).not.toThrow();

    const openConflict = cloneJson(closed);
    objectArray(openConflict, "conflicts")[0]!.captureId = "missing-capture";
    expectImportIssue(buildBundle(openConflict), "REFERENCE_INVALID");

    const openIssue = cloneJson(closed);
    objectArray(openIssue, "issues")[0]!.observationId = "missing-observation";
    expectImportIssue(buildBundle(openIssue), "REFERENCE_INVALID");

    const duplicateIssue = cloneJson(closed);
    objectArray(duplicateIssue, "issues").push(
      cloneJson(objectArray(duplicateIssue, "issues")[0]!),
    );
    expectImportIssue(buildBundle(duplicateIssue), "REFERENCE_INVALID");
  });

  it("accepts representative exact count caps and rejects one-over conflict and issue caps", () => {
    const count = SCREEN_EVIDENCE_LIMITS_V1.captures;
    const captures: JsonObject[] = Array.from({ length: count }, (_, index) => ({
      captureId: `capture-${String(index).padStart(5, "0")}`,
      revision: 1,
      capturedAtEpochMs: 0,
    }));
    const payload = validPayload();
    payload.window = { startEpochMs: 0, endEpochMs: 0 };
    payload.captures = captures;
    payload.observations = [];
    payload.coverage = {
      captureCount: count,
      observationCount: 0,
      ocrSpanCount: 0,
      coveredCaptureCount: 0,
      coveredCaptureRatio: 0,
    };
    payload.conflicts = captures.map((capture) => ({
      code: "CAPTURE_REVISION_CONFLICT",
      captureId: capture.captureId!,
    }));
    payload.issues = captures.map((capture) => ({
      code: "OCR_UNAVAILABLE",
      captureId: capture.captureId!,
    }));

    expect(() => importFixture(buildBundle(payload))).not.toThrow();

    const excessiveConflicts = cloneJson(payload);
    objectArray(excessiveConflicts, "conflicts").push({
      code: "CAPTURE_REVISION_CONFLICT",
      captureId: "capture-00000",
    });
    expectImportIssue(buildBundle(excessiveConflicts), "PAYLOAD_INVALID");

    const excessiveIssues = cloneJson(payload);
    objectArray(excessiveIssues, "issues").push({
      code: "OCR_UNAVAILABLE",
      captureId: "capture-00000",
    });
    expectImportIssue(buildBundle(excessiveIssues), "PAYLOAD_INVALID");
  });
});

describe("screen evidence bundle V1 filesystem reader", () => {
  it("reads exactly four private regular files in canonical source order", async () => {
    const bundle = buildBundle();
    const { bundleDirectory } = await writePrivateBundle(bundle);

    const result = await readScreenEvidenceBundleV1({ bundleDirectory });

    expect(result.readDescriptor).toEqual({
      readSchemaVersion: "blabase.screen-evidence-read.v1",
      bundleDirectoryName: "screen-evidence-test-run",
      sourceOrder: SCREEN_EVIDENCE_BUNDLE_FILES_V1,
    });
    expect(result.imported.evidence).toEqual(importFixture(cloneBundle(bundle)).evidence);
    expect(result.sourceFiles).toEqual(
      bundle.entries.map((candidate) => ({
        relativePath: candidate.relativePath,
        entryKind: "regular-file",
        byteLength: candidate.byteLength,
        rawSha256: sha256(candidate.bytes),
      })),
    );
    expectDeeplyFrozen(result);
  });

  it("copies exact source entries into fresh caller-owned bytes without exposing reader state", async () => {
    const bundle = buildBundle();
    const { bundleDirectory } = await writePrivateBundle(bundle);
    const result = await readScreenEvidenceBundleV1({ bundleDirectory });
    const descriptorBeforeMutation = {
      ...result.readDescriptor,
      sourceOrder: [...result.readDescriptor.sourceOrder],
    };
    const sourceFilesBeforeMutation = result.sourceFiles.map((sourceFile) => ({
      ...sourceFile,
    }));

    const first = result.copySourceEntries();
    const second = result.copySourceEntries();

    expect(first.bundleDirectoryName).toBe("screen-evidence-test-run");
    expect(first.entries.map((candidate) => candidate.relativePath)).toEqual(
      SCREEN_EVIDENCE_BUNDLE_FILES_V1,
    );
    expect(first.entries).toHaveLength(4);
    expect(first).not.toBe(second);
    expect(first.entries).not.toBe(second.entries);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries)).toBe(true);

    for (let index = 0; index < bundle.entries.length; index += 1) {
      const expected = bundle.entries[index]!;
      const firstEntry = first.entries[index]!;
      const secondEntry = second.entries[index]!;
      expect(firstEntry).toEqual({
        relativePath: expected.relativePath,
        entryKind: "regular-file",
        byteLength: expected.byteLength,
        bytes: expected.bytes,
      });
      expect(firstEntry).not.toBe(secondEntry);
      expect(firstEntry.bytes).not.toBe(secondEntry.bytes);
      expect(firstEntry.bytes).not.toBe(expected.bytes);
      expect(new Uint8Array(firstEntry.bytes)).toEqual(expected.bytes);
      expect(new Uint8Array(secondEntry.bytes)).toEqual(expected.bytes);
      expect(Object.isFrozen(firstEntry)).toBe(true);
      expect(Object.isFrozen(secondEntry)).toBe(true);
    }

    first.entries[0]!.bytes.fill(0);
    const third = result.copySourceEntries();
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third.entries).not.toBe(first.entries);
    expect(third.entries).not.toBe(second.entries);
    expect(new Uint8Array(second.entries[0]!.bytes)).toEqual(
      bundle.entries[0]!.bytes,
    );
    expect(new Uint8Array(third.entries[0]!.bytes)).toEqual(
      bundle.entries[0]!.bytes,
    );
    expect(result.readDescriptor).toEqual(descriptorBeforeMutation);
    expect(result.sourceFiles).toEqual(sourceFilesBeforeMutation);
    expect(result.sourceFiles[0]?.rawSha256).toBe(
      sha256(bundle.entries[0]!.bytes),
    );
  });

  it("rejects an extra filesystem entry", async () => {
    const { bundleDirectory } = await writePrivateBundle(buildBundle());
    const extraPath = path.join(bundleDirectory, "extra.json");
    await writeFile(extraPath, "{}", { mode: 0o600 });
    await chmod(extraPath, 0o600);

    await expectReadIssue(bundleDirectory, "ENTRY_SET_MISMATCH");
  });

  it("rejects a symlink in place of a required regular file where supported", async () => {
    if (process.platform === "win32") return;
    const bundle = buildBundle();
    const { bundleDirectory, root } = await writePrivateBundle(bundle);
    const target = path.join(root, "outside-payload.json");
    await writeFile(target, bundleEntry(bundle, "payload.json").bytes, { mode: 0o600 });
    await chmod(target, 0o600);
    const payloadPath = path.join(bundleDirectory, "payload.json");
    await unlink(payloadPath);
    await symlink(target, payloadPath);

    await expectReadIssue(bundleDirectory, "FILE_UNSAFE");
  });

  it("bounds reads to the opened size plus one byte and rejects same-inode growth", async () => {
    const bundle = buildBundle();
    const { bundleDirectory } = await writePrivateBundle(bundle);
    const payloadPath = path.join(bundleDirectory, "payload.json");
    const payloadByteCount = bundleEntry(bundle, "payload.json").bytes.byteLength;
    const probeHandle = await open(payloadPath, "r");
    const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as {
      read: (
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) => Promise<{ bytesRead: number; buffer: Uint8Array }>;
    };
    await probeHandle.close();

    const originalRead = fileHandlePrototype.read;
    let growthInjected = false;
    let observedBufferByteLength: number | undefined;
    let observedRequestedByteCount: number | undefined;
    fileHandlePrototype.read = async function (
      this: unknown,
      buffer,
      offset,
      length,
      position,
    ) {
      if (!growthInjected && buffer.byteLength === payloadByteCount + 1) {
        growthInjected = true;
        observedBufferByteLength = buffer.byteLength;
        observedRequestedByteCount = length;
        await appendFile(payloadPath, new Uint8Array([0]));
      }
      return Reflect.apply(originalRead, this, [buffer, offset, length, position]);
    };

    try {
      await expectReadIssue(bundleDirectory, "FILE_UNSTABLE");
      expect(growthInjected).toBe(true);
      expect(observedBufferByteLength).toBe(payloadByteCount + 1);
      expect(observedRequestedByteCount).toBeLessThanOrEqual(payloadByteCount + 1);
    } finally {
      fileHandlePrototype.read = originalRead;
    }
  });

  it("rejects a hard-linked required file where supported", async () => {
    if (process.platform === "win32") return;
    const { bundleDirectory, root } = await writePrivateBundle(buildBundle());
    const payloadPath = path.join(bundleDirectory, "payload.json");
    await link(payloadPath, path.join(root, "payload-hardlink.json"));

    await expectReadIssue(bundleDirectory, "FILE_UNSAFE");
  });

  it("rejects a required file with non-private permissions where POSIX permissions apply", async () => {
    if (process.platform === "win32") return;
    const { bundleDirectory } = await writePrivateBundle(buildBundle());
    await chmod(path.join(bundleDirectory, "payload.json"), 0o640);

    await expectReadIssue(bundleDirectory, "FILE_UNSAFE");
  });

  it("rejects a non-private bundle directory where POSIX permissions apply", async () => {
    if (process.platform === "win32") return;
    const { bundleDirectory } = await writePrivateBundle(buildBundle());
    await chmod(bundleDirectory, 0o750);

    await expectReadIssue(bundleDirectory, "BUNDLE_DIRECTORY_UNSAFE");
  });
});
