import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../src/dayflowEvidence/contracts";
import {
  DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
  DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS,
  DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION,
  DayflowPreprocessedEvidenceCoreError,
  dayflowPreprocessedEvidenceSha256,
  inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification,
  parseCanonicalDayflowPreprocessedEvidenceV0_1,
  sealDayflowPreprocessedEvidenceV0_1,
  serializeDayflowPreprocessedEvidenceV0_1,
  type DayflowPreprocessedEvidenceCoreIssueCode,
  type DayflowPreprocessedEvidenceDeferredIssueCodeV0_1,
  type DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1,
  type DayflowPreprocessedEvidenceV0_1Preimage,
} from "../src/dayflowEvidence/preprocessedEvidenceV0_1";

const START = "2026-08-20T00:00:00.000Z";
const END = "2026-08-20T00:00:01.000Z";
const COMPLETED = "2026-08-20T00:00:02.000Z";
const ZERO_HASH = "0".repeat(64);
const ONE_HASH = "1".repeat(64);
const TWO_HASH = "2".repeat(64);
const THREE_HASH = "3".repeat(64);
const encoder = new TextEncoder();

function rawSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function observedPreimage(): DayflowPreprocessedEvidenceV0_1Preimage {
  const text = "Synthetic task context";
  return {
    schemaVersion: DAYFLOW_PREPROCESSED_EVIDENCE_SCHEMA_VERSION,
    dataOrigin: "synthetic",
    studyPhase: "contract_conformance",
    studyProtocolHash: ZERO_HASH,
    transportBinding: {
      importSchemaVersion: "dayflow-screen-evidence-bundle-import-v0.1",
      manifestRawSha256: ONE_HASH,
      manifestDetachedSha256: TWO_HASH,
      completionSha256: THREE_HASH,
      objectCount: 1,
      totalObjectBytes: 18,
      replayIdentitySha256: ZERO_HASH,
    },
    preprocessing: {
      runId: "synthetic-e2-schema-run-1",
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
    coverageCode: "observed",
    coverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: "running",
          expectedFrameCount: 1,
          observedFrameCount: 1,
          rejectedFrameCount: 0,
        },
      ],
      expectedFrameCount: 1,
      observedFrameCount: 1,
      rejectedFrameCount: 0,
    },
    frames: [
      {
        frameOrdinal: 0,
        sourceArtifactRef: {
          artifactType: "dayflow_export_frame",
          exportRef: {
            schemaVersion: "dayflow-screen-evidence-export-v0.1",
            exportId: "synthetic-e2-export-1",
            detachedManifestSha256: TWO_HASH,
          },
          sourceRowId: "1",
          blobSha256: THREE_HASH,
        },
        capturedAt: START,
        result: {
          status: "text",
          spans: [
            {
              spanOrdinal: 0,
              textKind: "privacy_filtered_ocr",
              text,
              textSha256: rawSha256(text),
              confidence: { status: "reported", basisPoints: 9_500 },
              redaction: { status: "none_detected", categories: [] },
            },
          ],
        },
      },
    ],
  };
}

function validEmptyPreimage(): DayflowPreprocessedEvidenceV0_1Preimage {
  const value = observedPreimage();
  return {
    ...value,
    transportBinding: {
      ...value.transportBinding,
      objectCount: 0,
      totalObjectBytes: 0,
    },
    coverageCode: "valid-empty",
    coverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: "paused",
          expectedFrameCount: 0,
          observedFrameCount: 0,
          rejectedFrameCount: 0,
        },
      ],
      expectedFrameCount: 0,
      observedFrameCount: 0,
      rejectedFrameCount: 0,
    },
    frames: [],
  };
}

function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(jcsCanonicalize(value) + "\n");
}

function manuallySealSemanticFixture(
  preimage: DayflowPreprocessedEvidenceV0_1Preimage,
): Uint8Array {
  return canonicalBytes({
    ...preimage,
    dayflowPreprocessedEvidenceSha256: domainSeparatedSha256(
      DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN,
      preimage,
    ),
  });
}

function expectAcceptedForResolution(
  preimage: DayflowPreprocessedEvidenceV0_1Preimage,
  expectedIssueCodes: readonly DayflowPreprocessedEvidenceDeferredIssueCodeV0_1[],
  expectedResolvedOwners: readonly DayflowPreprocessedEvidenceDeferredResolvedOwnerV0_1[] = [],
) {
  const inspected =
    inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
      manuallySealSemanticFixture(preimage),
    );
  expect(inspected.status).toBe("accepted-for-resolution");
  if (inspected.status !== "accepted-for-resolution") {
    throw new Error("Expected structural candidate to be accepted");
  }
  expect(inspected.deferredIssueCodes).toEqual(expectedIssueCodes);
  expect(inspected.deferredResolvedOwners).toEqual(expectedResolvedOwners);
  expect(Object.isFrozen(inspected)).toBe(true);
  expect(Object.isFrozen(inspected.candidate)).toBe(true);
  expect(Object.isFrozen(inspected.deferredIssueCodes)).toBe(true);
  expect(Object.isFrozen(inspected.deferredResolvedOwners)).toBe(true);
  return inspected;
}

function nestedArrays(containerCount: number): unknown[] {
  let value: unknown[] = [];
  for (let index = 1; index < containerCount; index += 1) {
    value = [value];
  }
  return value;
}

function preimageAtCanonicalDocumentBytes(
  targetBytes: number,
): DayflowPreprocessedEvidenceV0_1Preimage {
  const value = observedPreimage();
  const baseBytes = canonicalBytes(
    sealDayflowPreprocessedEvidenceV0_1(value),
  ).byteLength;
  const paddingBytes = targetBytes - baseBytes;
  if (paddingBytes < 0) {
    throw new Error("Target canonical document is smaller than the fixture");
  }
  value.frames[0]!.sourceArtifactRef.sourceRowId += "0".repeat(paddingBytes);
  return value;
}

function expectCoreIssue(
  callback: () => unknown,
  issueCode: DayflowPreprocessedEvidenceCoreIssueCode,
): void {
  try {
    callback();
    throw new Error("Expected core parser to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DayflowPreprocessedEvidenceCoreError);
    expect(error).toMatchObject({ issueCode });
  }
}

describe("DayflowPreprocessedEvidence v0.1 core", () => {
  it("seals, serializes, and parses one canonical observed artifact", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(sealed);
    const parsed = parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes);

    expect(parsed).toEqual(sealed);
    expect(parsed.dayflowPreprocessedEvidenceSha256).toBe(
      dayflowPreprocessedEvidenceSha256(observedPreimage()),
    );
    expect(DAYFLOW_PREPROCESSED_EVIDENCE_HASH_DOMAIN).toBe(
      "blabase.dayflow-preprocessed-evidence.v0.1",
    );
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.frames)).toBe(true);
    expect(Object.isFrozen(parsed.frames[0]?.result)).toBe(true);
  });

  it("seals and parses valid-empty evidence without suggestion semantics", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(
      validEmptyPreimage(),
    );
    const parsed = parseCanonicalDayflowPreprocessedEvidenceV0_1(
      serializeDayflowPreprocessedEvidenceV0_1(sealed),
    );

    expect(parsed.coverageCode).toBe("valid-empty");
    expect(parsed.transportBinding.objectCount).toBe(0);
    expect(parsed.frames).toEqual([]);
    expect(JSON.stringify(parsed)).not.toMatch(
      /semanticOutput|RECENT_FOCUS|VISIBLE_TASK_INTENT|"title"|"summary"/u,
    );
  });

  it("produces the same detached hash for the same preimage", () => {
    const first = observedPreimage();
    const second = structuredClone(first);
    expect(dayflowPreprocessedEvidenceSha256(second)).toBe(
      dayflowPreprocessedEvidenceSha256(first),
    );
  });

  it("rejects a duplicate decoded JSON key", () => {
    const bytes = encoder.encode(
      '{"schemaVersion":"dayflow-preprocessed-evidence-v0.1","schemaVersion":"dayflow-preprocessed-evidence-v0.1"}\n',
    );
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "JSON_DUPLICATE_KEY",
    );
  });

  it("rejects valid JSON that is not exact JCS plus one LF", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = encoder.encode(JSON.stringify(sealed, null, 2));
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "JSON_NOT_CANONICAL",
    );
  });

  it("rejects a canonical artifact with a stale detached hash", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = canonicalBytes({
      ...sealed,
      dayflowPreprocessedEvidenceSha256: ZERO_HASH,
    });
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "HASH_MISMATCH",
    );
  });

  it("rejects suggestion-shaped fields under the strict schema", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = canonicalBytes({
      ...sealed,
      semanticOutput: {
        status: "suggestions_available",
        items: [{ title: "Forbidden", summary: "Forbidden" }],
      },
    });
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "SCHEMA_INVALID",
    );
  });

  it("rejects unsafe OCR text and mismatched text hashes", () => {
    const unsafe = observedPreimage();
    unsafe.frames[0]!.result.spans[0]!.text = "unsafe\u0000text";
    expect(() => sealDayflowPreprocessedEvidenceV0_1(unsafe)).toThrow();

    const staleHash = observedPreimage();
    staleHash.frames[0]!.result.spans[0]!.textSha256 = ZERO_HASH;
    expect(() => sealDayflowPreprocessedEvidenceV0_1(staleHash)).toThrow();
  });

  it("rejects noncontiguous ordinals and failure-shaped evidence", () => {
    const ordinal = observedPreimage();
    ordinal.frames[0]!.frameOrdinal = 1;
    expect(() => sealDayflowPreprocessedEvidenceV0_1(ordinal)).toThrow();

    const failure = observedPreimage();
    failure.coverageCode = "failure";
    expect(() => sealDayflowPreprocessedEvidenceV0_1(failure)).toThrow();
  });

  it("rejects one-byte-over canonical candidate input before parsing", () => {
    const bytes = new Uint8Array(512 * 1024 + 1);
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("uses intrinsic Uint8Array slots for a hostile subclass", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(sealed);
    class HostileUint8Array extends Uint8Array {}
    const hostile = new HostileUint8Array(bytes);
    const calls = {
      buffer: 0,
      byteLength: 0,
      iterator: 0,
      species: 0,
    };
    Object.defineProperties(hostile, {
      buffer: {
        get() {
          calls.buffer += 1;
          throw new Error("caller buffer getter must not run");
        },
      },
      byteLength: {
        get() {
          calls.byteLength += 1;
          return 1;
        },
      },
      [Symbol.iterator]: {
        value() {
          calls.iterator += 1;
          throw new Error("caller iterator must not run");
        },
      },
    });
    Object.defineProperty(HostileUint8Array, Symbol.species, {
      get() {
        calls.species += 1;
        throw new Error("caller species must not run");
      },
    });

    expect(parseCanonicalDayflowPreprocessedEvidenceV0_1(hostile)).toEqual(
      sealed,
    );
    expect(calls).toEqual({
      buffer: 0,
      byteLength: 0,
      iterator: 0,
      species: 0,
    });
  });

  it("ignores an oversized subclass iterator and copies the intrinsic view", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(sealed);
    class IteratorHostileUint8Array extends Uint8Array {}
    const hostile = new IteratorHostileUint8Array(bytes);
    let iteratorCalls = 0;
    Object.defineProperty(hostile, Symbol.iterator, {
      value: function* () {
        iteratorCalls += 1;
        for (
          let index = 0;
          index <=
          DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes;
          index += 1
        ) {
          yield 0;
        }
      },
    });

    expect(parseCanonicalDayflowPreprocessedEvidenceV0_1(hostile)).toEqual(
      sealed,
    );
    expect(iteratorCalls).toBe(0);
  });

  it("enforces the intrinsic subclass view length before copying", () => {
    class LengthHostileUint8Array extends Uint8Array {}
    const hostile = new LengthHostileUint8Array(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes + 1,
    );
    Object.defineProperty(hostile, "byteLength", {
      get() {
        return 1;
      },
    });
    Object.defineProperty(hostile, Symbol.iterator, {
      value: function* () {
        yield 0;
      },
    });

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(hostile),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("rejects a Proxy around a Uint8Array as core input-invalid", () => {
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(
      sealDayflowPreprocessedEvidenceV0_1(observedPreimage()),
    );
    const proxied = new Proxy(bytes, {});

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(proxied),
      "INPUT_INVALID",
    );
  });

  it("maps a detached ArrayBuffer view to core input-invalid", () => {
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(
      sealDayflowPreprocessedEvidenceV0_1(observedPreimage()),
    );
    const detached = Uint8Array.from(bytes);
    const buffer = detached.buffer as ArrayBuffer;
    structuredClone(buffer, { transfer: [buffer] });

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(detached),
      "INPUT_INVALID",
    );
  });

  it("rejects a SharedArrayBuffer view as core input-invalid", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(
      sealDayflowPreprocessedEvidenceV0_1(observedPreimage()),
    );
    const shared = new SharedArrayBuffer(bytes.byteLength);
    const sharedView = new Uint8Array(shared);
    sharedView.set(bytes);

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(sharedView),
      "INPUT_INVALID",
    );
  });

  it("reports oversized SharedArrayBuffer input-invalid before size", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const shared = new SharedArrayBuffer(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes + 1,
    );

    expectCoreIssue(
      () =>
        parseCanonicalDayflowPreprocessedEvidenceV0_1(
          new Uint8Array(shared),
        ),
      "INPUT_INVALID",
    );
  });

  it("rejects a resizable ArrayBuffer view when the runtime supports it", () => {
    const ResizableArrayBuffer = ArrayBuffer as typeof ArrayBuffer & {
      new (
        byteLength: number,
        options: { maxByteLength: number },
      ): ArrayBuffer;
    };
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(
      sealDayflowPreprocessedEvidenceV0_1(observedPreimage()),
    );
    let buffer: ArrayBuffer;
    try {
      buffer = new ResizableArrayBuffer(bytes.byteLength, {
        maxByteLength: bytes.byteLength + 1,
      });
    } catch {
      return;
    }
    const resizableGetter = Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "resizable",
    )?.get;
    if (resizableGetter?.call(buffer) !== true) return;
    const view = new Uint8Array(buffer);
    view.set(bytes);

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(view),
      "INPUT_INVALID",
    );
  });

  it("reports oversized resizable input-invalid before size when supported", () => {
    const ResizableArrayBuffer = ArrayBuffer as typeof ArrayBuffer & {
      new (
        byteLength: number,
        options: { maxByteLength: number },
      ): ArrayBuffer;
    };
    const byteLength =
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes + 1;
    let buffer: ArrayBuffer;
    try {
      buffer = new ResizableArrayBuffer(byteLength, {
        maxByteLength: byteLength + 1,
      });
    } catch {
      return;
    }
    const resizableGetter = Object.getOwnPropertyDescriptor(
      ArrayBuffer.prototype,
      "resizable",
    )?.get;
    if (resizableGetter?.call(buffer) !== true) return;

    expectCoreIssue(
      () =>
        parseCanonicalDayflowPreprocessedEvidenceV0_1(
          new Uint8Array(buffer),
        ),
      "INPUT_INVALID",
    );
  });

  it("rejects a growable SharedArrayBuffer view when supported", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const GrowableSharedArrayBuffer =
      SharedArrayBuffer as typeof SharedArrayBuffer & {
        new (
          byteLength: number,
          options: { maxByteLength: number },
        ): SharedArrayBuffer;
      };
    const byteLength =
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes + 1;
    let buffer: SharedArrayBuffer;
    try {
      buffer = new GrowableSharedArrayBuffer(byteLength, {
        maxByteLength: byteLength + 1,
      });
    } catch {
      return;
    }
    const growableGetter = Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "growable",
    )?.get;
    if (growableGetter?.call(buffer) !== true) return;

    expectCoreIssue(
      () =>
        parseCanonicalDayflowPreprocessedEvidenceV0_1(
          new Uint8Array(buffer),
        ),
      "INPUT_INVALID",
    );
  });

  it("preserves empty ordinary input as core invalid JSON", () => {
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(new Uint8Array()),
      "JSON_INVALID",
    );
  });

  it("seals, serializes, and parses an exact 512 KiB artifact", () => {
    const preimage = preimageAtCanonicalDocumentBytes(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes,
    );
    const sealed = sealDayflowPreprocessedEvidenceV0_1(preimage);
    const bytes = serializeDayflowPreprocessedEvidenceV0_1(sealed);

    expect(bytes).toHaveLength(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes,
    );
    expect(parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes)).toEqual(
      sealed,
    );
  });

  it("rejects an exact 512 KiB plus one artifact at seal and serialize", () => {
    const preimage = preimageAtCanonicalDocumentBytes(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes + 1,
    );
    expectCoreIssue(
      () => sealDayflowPreprocessedEvidenceV0_1(preimage),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const oversized = {
      ...preimage,
      dayflowPreprocessedEvidenceSha256:
        dayflowPreprocessedEvidenceSha256(preimage),
    };
    expect(canonicalBytes(oversized)).toHaveLength(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes + 1,
    );
    expectCoreIssue(
      () => serializeDayflowPreprocessedEvidenceV0_1(oversized),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("accepts parser depth 10 before applying the strict root schema", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = canonicalBytes({
      ...sealed,
      depthBoundaryProbe: nestedArrays(9),
    });

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "SCHEMA_INVALID",
    );
  });

  it("rejects parser depth 11 before schema validation", () => {
    const sealed = sealDayflowPreprocessedEvidenceV0_1(observedPreimage());
    const bytes = canonicalBytes({
      ...sealed,
      depthBoundaryProbe: nestedArrays(10),
    });

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("reports invalid syntax before a depth 11 resource limit", () => {
    const nestedContainers = 10;
    const bytes = encoder.encode(
      '{"depthBoundaryProbe":' +
        "[".repeat(nestedContainers) +
        "0" +
        "]".repeat(nestedContainers - 1) +
        "}\n",
    );

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "JSON_INVALID",
    );
  });

  it("reports a decoded duplicate elsewhere before a depth 11 limit", () => {
    const nestedContainers = 10;
    const bytes = encoder.encode(
      '{"depthBoundaryProbe":' +
        "[".repeat(nestedContainers) +
        "0" +
        "]".repeat(nestedContainers) +
        ',"duplicate":0,"duplicate":1}\n',
    );

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "JSON_DUPLICATE_KEY",
    );
  });

  it("reports an escaped duplicate alias before a depth 11 limit", () => {
    const nestedContainers = 10;
    const bytes = encoder.encode(
      '{"depthBoundaryProbe":' +
        "[".repeat(nestedContainers) +
        "0" +
        "]".repeat(nestedContainers) +
        ',"duplicate":0,"\\u0064uplicate":1}\n',
    );

    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "JSON_DUPLICATE_KEY",
    );
  });

  it("collects each deferred semantic issue code independently", () => {
    const cases: ReadonlyArray<{
      issueCode: DayflowPreprocessedEvidenceDeferredIssueCodeV0_1;
      mutate: (value: DayflowPreprocessedEvidenceV0_1Preimage) => void;
    }> = [
      {
        issueCode: "CAPTURE_WINDOW_MISMATCH",
        mutate(value) {
          value.captureWindow.end = value.captureWindow.start;
        },
      },
      {
        issueCode: "CHRONOLOGY_INVALID",
        mutate(value) {
          value.preprocessing.completedAt = value.captureWindow.start;
        },
      },
      {
        issueCode: "PREPROCESSING_PROVENANCE_INVALID",
        mutate(value) {
          value.preprocessing.ocr.modelId = null;
        },
      },
      {
        issueCode: "OCR_TEXT_INVALID",
        mutate(value) {
          const span = value.frames[0]!.result.spans[0]!;
          span.text = "e\u0301";
          span.textSha256 = rawSha256(span.text);
        },
      },
      {
        issueCode: "OCR_TEXT_HASH_MISMATCH",
        mutate(value) {
          value.frames[0]!.result.spans[0]!.textSha256 = ZERO_HASH;
        },
      },
      {
        issueCode: "PRIVACY_METADATA_INVALID",
        mutate(value) {
          const redaction =
            value.frames[0]!.result.spans[0]!.redaction;
          redaction.status = "redacted";
          redaction.categories = [];
        },
      },
      {
        issueCode: "RESOURCE_COUNT_MISMATCH",
        mutate(value) {
        value.transportBinding.objectCount = 2;
        },
      },
    ];

    for (const testCase of cases) {
      const value = observedPreimage();
      testCase.mutate(value);
      expectAcceptedForResolution(value, [testCase.issueCode]);
    }
  });

  it("applies structural and hash gates before deferred collection", () => {
    const privacy = observedPreimage();
    const redaction = privacy.frames[0]!.result.spans[0]!.redaction;
    redaction.status = "redacted";
    redaction.categories = [];
    const hashAndPrivacy =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        canonicalBytes({
          ...privacy,
          dayflowPreprocessedEvidenceSha256: ZERO_HASH,
        }),
      );
    expect(hashAndPrivacy).toEqual({
      status: "rejected",
      issueCode: "HASH_MISMATCH",
    });

    const structurallyInvalid =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        canonicalBytes({
          ...privacy,
          semanticOutput: { status: "suggestions_available" },
          dayflowPreprocessedEvidenceSha256: ZERO_HASH,
        }),
      );
    expect(structurallyInvalid).toEqual({
      status: "rejected",
      issueCode: "SCHEMA_INVALID",
    });
  });

  it("sorts and deduplicates deferred semantic issue codes", () => {
    const combined = observedPreimage();
    const combinedSpan = combined.frames[0]!.result.spans[0]!;
    combinedSpan.textSha256 = ZERO_HASH;
    combinedSpan.redaction.status = "redacted";
    combinedSpan.redaction.categories = [];
    expectAcceptedForResolution(combined, [
      "OCR_TEXT_HASH_MISMATCH",
      "PRIVACY_METADATA_INVALID",
    ]);

    const duplicated = observedPreimage();
    const result = duplicated.frames[0]!.result;
    if (result.status !== "text") throw new Error("Expected text fixture");
    result.spans[0]!.textSha256 = ZERO_HASH;
    const secondSpan = structuredClone(result.spans[0]!);
    secondSpan.spanOrdinal = 1;
    secondSpan.text = "Second synthetic context";
    secondSpan.textSha256 = ZERO_HASH;
    result.spans.push(secondSpan);
    expectAcceptedForResolution(duplicated, [
      "OCR_TEXT_HASH_MISMATCH",
    ]);
  });

  function inspectAcceptedSemanticFixture(
    value: Parameters<typeof manuallySealSemanticFixture>[0],
  ) {
    const inspected =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        manuallySealSemanticFixture(value),
      );
    expect(inspected.status).toBe("accepted-for-resolution");
    if (inspected.status !== "accepted-for-resolution") {
      throw new Error("Expected accepted-for-resolution inspection");
    }
    return inspected;
  }

  function twoFrameObservedFixture() {
    const value = observedPreimage();
    const firstFrame = value.frames[0]!;
    const secondFrame = structuredClone(firstFrame);
    secondFrame.frameOrdinal = firstFrame.frameOrdinal + 1;
    value.frames.push(secondFrame);
    value.transportBinding.objectCount = 2;
    value.coverage.observedFrameCount = 2;
    value.coverage.intervals[0]!.observedFrameCount = 2;
    return value;
  }

  function replaceWithDifferentHash(value: string): string {
    return value === ZERO_HASH ? "1".repeat(64) : ZERO_HASH;
  }

  function splitCoverageIntervals(
    value: ReturnType<typeof observedPreimage>,
    discontinuous: boolean,
  ): void {
    const interval = value.coverage.intervals[0]!;
    const startMilliseconds = Date.parse(interval.start);
    const endMilliseconds = Date.parse(interval.end);
    const midpoint = new Date(
      Math.floor((startMilliseconds + endMilliseconds) / 2),
    ).toISOString();
    const laterStart = new Date(
      Math.floor((Date.parse(midpoint) + endMilliseconds) / 2),
    ).toISOString();
    value.coverage.intervals = [
      {
        ...structuredClone(interval),
        end: midpoint,
      },
      {
        ...structuredClone(interval),
        start: discontinuous ? laterStart : midpoint,
        observedFrameCount: 0,
      },
    ];
  }

  it("classifies every coverage-owned semantic failure", () => {
    const failure = observedPreimage();
    failure.coverageCode = "failure";

    const validEmptyConflict = observedPreimage();
    validEmptyConflict.coverageCode = "valid-empty";

    const observedZero = observedPreimage();
    observedZero.transportBinding.objectCount = 0;
    observedZero.frames = [];

    const emptyIntervals = observedPreimage();
    emptyIntervals.coverage.intervals = [];

    const invalidInterval = observedPreimage();
    invalidInterval.coverage.intervals[0]!.end =
      invalidInterval.coverage.intervals[0]!.start;

    const invalidRejectedCount = observedPreimage();
    const rejectedInterval = invalidRejectedCount.coverage.intervals[0]!;
    rejectedInterval.rejectedFrameCount =
      rejectedInterval.observedFrameCount + 1;
    invalidRejectedCount.coverage.rejectedFrameCount =
      rejectedInterval.rejectedFrameCount;

    const invalidSums = observedPreimage();
    invalidSums.coverage.observedFrameCount += 1;

    const discontinuous = observedPreimage();
    splitCoverageIntervals(discontinuous, true);

    const adjacentEqualReasons = observedPreimage();
    splitCoverageIntervals(adjacentEqualReasons, false);

    for (const value of [
      failure,
      validEmptyConflict,
      observedZero,
      emptyIntervals,
      invalidInterval,
      invalidRejectedCount,
      invalidSums,
      discontinuous,
      adjacentEqualReasons,
    ]) {
      const inspected = inspectAcceptedSemanticFixture(value);
      expect(inspected.deferredResolvedOwners).toEqual(["COVERAGE"]);
      expect(Object.isFrozen(inspected.deferredResolvedOwners)).toBe(true);
    }
  });

  it("classifies source binding, set, and export ownership", () => {
    const manifestMismatch = observedPreimage();
    const manifestExport =
      manifestMismatch.frames[0]!.sourceArtifactRef.exportRef;
    manifestExport.detachedManifestSha256 = replaceWithDifferentHash(
      manifestMismatch.transportBinding.manifestDetachedSha256,
    );
    expect(
      inspectAcceptedSemanticFixture(manifestMismatch).deferredResolvedOwners,
    ).toEqual(["SOURCE_ARTIFACT_BINDING"]);

    const duplicateRefs = twoFrameObservedFixture();
    expect(
      inspectAcceptedSemanticFixture(duplicateRefs).deferredResolvedOwners,
    ).toEqual(["SOURCE_ARTIFACT_SET"]);

    const multipleExports = twoFrameObservedFixture();
    const secondExport =
      multipleExports.frames[1]!.sourceArtifactRef.exportRef;
    const originalExportId = secondExport.exportId;
    secondExport.exportId = `${originalExportId.slice(0, -1)}${
      originalExportId.endsWith("0") ? "1" : "0"
    }`;
    expect(
      inspectAcceptedSemanticFixture(multipleExports).deferredResolvedOwners,
    ).toEqual(["SOURCE_ARTIFACT_BINDING"]);

    const duplicateAndBinding = twoFrameObservedFixture();
    const mismatchedManifest = replaceWithDifferentHash(
      duplicateAndBinding.transportBinding.manifestDetachedSha256,
    );
    for (const frame of duplicateAndBinding.frames) {
      frame.sourceArtifactRef.exportRef.detachedManifestSha256 =
        mismatchedManifest;
    }
    expect(
      inspectAcceptedSemanticFixture(duplicateAndBinding)
        .deferredResolvedOwners,
    ).toEqual(["SOURCE_ARTIFACT_BINDING", "SOURCE_ARTIFACT_SET"]);
  });

  it("keeps intrinsic issues and resolved owners in separate frozen arrays", () => {
    const combined = observedPreimage();
    combined.coverage.intervals = [];
    const combinedSpan = combined.frames[0]!.result.spans[0]!;
    combinedSpan.textSha256 = ZERO_HASH;
    const inspected = inspectAcceptedSemanticFixture(combined);
    expect(inspected.deferredIssueCodes).toEqual(["OCR_TEXT_HASH_MISMATCH"]);
    expect(inspected.deferredResolvedOwners).toEqual(["COVERAGE"]);
    expect(Object.isFrozen(inspected.deferredIssueCodes)).toBe(true);
    expect(Object.isFrozen(inspected.deferredResolvedOwners)).toBe(true);
  });

  it("applies structural and stale-root-hash gates before resolved owners", () => {
    const owned = observedPreimage();
    owned.coverage.intervals = [];
    owned.frames[0]!.result.spans[0]!.textSha256 = ZERO_HASH;

    const correctlySealed = new TextDecoder().decode(
      manuallySealSemanticFixture(owned),
    );
    const staleSealed = correctlySealed.replace(
      /("dayflowPreprocessedEvidenceSha256":")([0-9a-f]{64})(")/u,
      (_match, prefix: string, hash: string, suffix: string) =>
        `${prefix}${replaceWithDifferentHash(hash)}${suffix}`,
    );
    const hashRejected =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        new TextEncoder().encode(staleSealed),
      );
    expect(hashRejected).toEqual({
      status: "rejected",
      issueCode: "HASH_MISMATCH",
    });

    const structural = observedPreimage() as ReturnType<
      typeof observedPreimage
    > & { semanticOutput?: string };
    structural.coverage.intervals = [];
    structural.frames[0]!.result.spans[0]!.textSha256 = ZERO_HASH;
    structural.semanticOutput = "forbidden field";
    const structurallyRejected =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        manuallySealSemanticFixture(structural),
      );
    expect(structurallyRejected).toEqual({
      status: "rejected",
      issueCode: "SCHEMA_INVALID",
    });
  });

  it("returns empty frozen deferred arrays for valid coverage modes", () => {
    for (const value of [observedPreimage(), validEmptyPreimage()]) {
      const inspected = inspectAcceptedSemanticFixture(value);
      expect(inspected.deferredIssueCodes).toEqual([]);
      expect(inspected.deferredResolvedOwners).toEqual([]);
      expect(Object.isFrozen(inspected.deferredIssueCodes)).toBe(true);
      expect(Object.isFrozen(inspected.deferredResolvedOwners)).toBe(true);
    }
  });

  it("preserves public parser SCHEMA_INVALID for resolved-owner semantics", () => {
    const invalidCoverage = observedPreimage();
    invalidCoverage.coverage.intervals = [];

    const invalidBinding = observedPreimage();
    invalidBinding.frames[0]!.sourceArtifactRef.exportRef.detachedManifestSha256 =
      replaceWithDifferentHash(
        invalidBinding.transportBinding.manifestDetachedSha256,
      );

    for (const value of [invalidCoverage, invalidBinding]) {
      try {
        parseCanonicalDayflowPreprocessedEvidenceV0_1(
          manuallySealSemanticFixture(value),
        );
        throw new Error("Expected public parser rejection");
      } catch (error) {
        expect(error).toMatchObject({ issueCode: "SCHEMA_INVALID" });
      }
    }
  });

  it("allows suggestion-like words in OCR values but rejects them as fields", () => {
    const value = observedPreimage();
    const span = value.frames[0]!.result.spans[0]!;
    span.text = "semanticOutput title RECENT_FOCUS";
    span.textSha256 = rawSha256(span.text);
    expectAcceptedForResolution(value, []);

    const sealed = sealDayflowPreprocessedEvidenceV0_1(
      observedPreimage(),
    );
    const fieldShaped =
      inspectCanonicalDayflowPreprocessedEvidenceV0_1ForResolvedVerification(
        canonicalBytes({
          ...sealed,
          title: "Forbidden structural field",
        }),
      );
    expect(fieldShaped).toEqual({
      status: "rejected",
      issueCode: "SCHEMA_INVALID",
    });
  });

  it("maps pathological deep JSON to the resource-limit issue", () => {
    const nestedContainers = 20_000;
    const bytes = encoder.encode(
      '{"depthBoundaryProbe":' +
        "[".repeat(nestedContainers) +
        "0" +
        "]".repeat(nestedContainers) +
        "}\n",
    );

    expect(bytes.byteLength).toBeLessThan(
      DAYFLOW_PREPROCESSED_EVIDENCE_LIMITS.canonicalDocumentBytes,
    );
    expectCoreIssue(
      () => parseCanonicalDayflowPreprocessedEvidenceV0_1(bytes),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });
});
