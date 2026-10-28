import { createHash } from "node:crypto";
import { types as nodeUtilTypes } from "node:util";

import type { ReadScreenEvidenceBundleV1Result } from "../../screenEvidence/readScreenEvidenceBundleV1";
import {
  canonicalPrivateScreenEvidenceJsonBytesV1,
} from "../../screenEvidence/privateScreenEvidenceFilesystemV1.internal";
import {
  publishPrivateEvaluationArtifactSetNoClobber,
} from "../privateArtifactStore";
import type {
  PrivateEvaluationArtifactSetFile,
  VerifiedPrivateEvaluationArtifactSet,
} from "../privateArtifactStore";

export const SCREEN_EVIDENCE_TASK1_INPUT_MANIFEST_SCHEMA_V1 =
  "blabase.screen-evidence-ablation.task1-evaluation-input-manifest.v1" as const;
export const SCREEN_EVIDENCE_TASK1_SELECTION_SCHEMA_V1 =
  "blabase.screen-evidence-ablation.task1-selection.v1" as const;
export const SCREEN_EVIDENCE_TASK1_INPUT_IDENTITY_DOMAIN_V1 =
  "blabase.screen-evidence-ablation.task1-evaluation-input.v1" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const textEncoder = new TextEncoder();

const SCREEN_SOURCE_FILES = Object.freeze([
  Object.freeze({
    sourceRelativePath: "payload.json" as const,
    storedRelativePath: "screen-evidence-payload.json" as const,
    mediaType: "application/json" as const,
  }),
  Object.freeze({
    sourceRelativePath: "manifest.json" as const,
    storedRelativePath: "screen-evidence-manifest.json" as const,
    mediaType: "application/json" as const,
  }),
  Object.freeze({
    sourceRelativePath: "manifest.sha256" as const,
    storedRelativePath: "screen-evidence-manifest.sha256" as const,
    mediaType: "text/plain; charset=us-ascii" as const,
  }),
  Object.freeze({
    sourceRelativePath: "COMPLETE" as const,
    storedRelativePath: "screen-evidence-COMPLETE" as const,
    mediaType: "text/plain; charset=us-ascii" as const,
  }),
] as const);

export const SCREEN_EVIDENCE_TASK1_INPUT_STORED_FILES_V1 = Object.freeze([
  "structured-evidence.json",
  ...SCREEN_SOURCE_FILES.map((file) => file.storedRelativePath),
  "selection-descriptor.json",
  "evaluation-input-manifest.json",
  "evaluation-input-manifest.sha256",
  "COMPLETE",
] as const);

export type ScreenEvidenceTask1SealIssueCodeV1 =
  | "INPUT_INVALID"
  | "WINDOW_INVALID"
  | "STRUCTURED_EVIDENCE_INVALID"
  | "SCREEN_EVIDENCE_INVALID"
  | "SELECTION_INVALID"
  | "PUBLICATION_FAILED";

export class ScreenEvidenceTask1SealErrorV1 extends Error {
  readonly issueCode: ScreenEvidenceTask1SealIssueCodeV1;

  constructor(issueCode: ScreenEvidenceTask1SealIssueCodeV1) {
    super(`ScreenEvidence Task 1 input seal failed (${issueCode})`);
    this.name = "ScreenEvidenceTask1SealErrorV1";
    this.issueCode = issueCode;
    Object.freeze(this);
  }
}

export type StructuredEvidenceTask1InputV1 = Readonly<{
  bytes: Uint8Array;
  startEpochSecond: number;
  endEpochSecond: number;
  asOfEpochSecond: number;
  byteLength: number;
  rawSha256: string;
  contentSha256: string;
}>;

export type ScreenEvidenceTask1ReadbackV1 = Pick<
  ReadScreenEvidenceBundleV1Result,
  "copySourceEntries"
>;

export type ScreenEvidenceTask1SourceInputV1 = Readonly<{
  readback: ScreenEvidenceTask1ReadbackV1;
  startEpochMs: number;
  endEpochMs: number;
  sourceRevision: number;
  manifestSha256: string;
  payloadSha256: string;
  replayIdentitySha256: string;
}>;

export type ScreenEvidenceTask1SelectionInputV1 = Readonly<{
  sourceSnapshotIdentitySha256: string;
  privacyReceiptSetSha256: string;
  retentionAsOfEpochMs: number;
}>;

export type SealScreenEvidenceTask1EvaluationInputV1Input = Readonly<{
  projectDirectory: string;
  inputRunId: string;
  structured: StructuredEvidenceTask1InputV1;
  screen: ScreenEvidenceTask1SourceInputV1;
  selection: ScreenEvidenceTask1SelectionInputV1;
}>;

export type ScreenEvidenceTask1SourceFileV1 = Readonly<{
  sourceRelativePath: (typeof SCREEN_SOURCE_FILES)[number]["sourceRelativePath"];
  storedRelativePath: (typeof SCREEN_SOURCE_FILES)[number]["storedRelativePath"];
  byteLength: number;
  rawSha256: string;
}>;

export type ScreenEvidenceTask1SelectionDescriptorV1 = Readonly<{
  schemaVersion: typeof SCREEN_EVIDENCE_TASK1_SELECTION_SCHEMA_V1;
  sourceSnapshotIdentitySha256: string;
  privacyReceiptSetSha256: string;
  retentionAsOfEpochMs: number;
}>;

export type ScreenEvidenceTask1EvaluationInputManifestV1 = Readonly<{
  schemaVersion: typeof SCREEN_EVIDENCE_TASK1_INPUT_MANIFEST_SCHEMA_V1;
  inputRunId: string;
  window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
    durationSeconds: 600;
    semantics: "inclusive";
    screenStartEpochMs: number;
    screenEndEpochMs: number;
  }>;
  structuredEvidence: Readonly<{
    storedRelativePath: "structured-evidence.json";
    byteLength: number;
    rawSha256: string;
    contentSha256: string;
    asOfEpochSecond: number;
  }>;
  screenEvidence: Readonly<{
    bundleDirectoryName: string;
    sourceRevision: number;
    manifestSha256: string;
    payloadSha256: string;
    replayIdentitySha256: string;
    sourceFiles: readonly ScreenEvidenceTask1SourceFileV1[];
  }>;
  selection: ScreenEvidenceTask1SelectionDescriptorV1 &
    Readonly<{ storedRelativePath: "selection-descriptor.json" }>;
  canonicalization: Readonly<{
    json: "rfc8785-jcs.utf8.v1";
    identityHashDomain: typeof SCREEN_EVIDENCE_TASK1_INPUT_IDENTITY_DOMAIN_V1;
    identityPreimage: "utf8-domain-nul-canonical-manifest-without-input-identity.v1";
  }>;
  inputIdentitySha256: string;
}>;

export type SealedScreenEvidenceTask1EvaluationInputV1 = Readonly<{
  relativeDirectory: string;
  directoryMode: number;
  inputIdentitySha256: string;
  manifestRawSha256: string;
  manifest: ScreenEvidenceTask1EvaluationInputManifestV1;
  files: VerifiedPrivateEvaluationArtifactSet["files"];
  copyFiles: () => readonly PrivateEvaluationArtifactSetFile[];
}>;

type OwnedScreenSourceFile = Readonly<{
  sourceRelativePath: ScreenEvidenceTask1SourceFileV1["sourceRelativePath"];
  storedRelativePath: ScreenEvidenceTask1SourceFileV1["storedRelativePath"];
  mediaType: string;
  bytes: Uint8Array;
  byteLength: number;
  rawSha256: string;
}>;

function fail(issueCode: ScreenEvidenceTask1SealIssueCodeV1): never {
  throw new ScreenEvidenceTask1SealErrorV1(issueCode);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function domainSeparatedSha256(domain: string, canonicalBytes: Uint8Array): string {
  return createHash("sha256")
    .update(textEncoder.encode(domain))
    .update(new Uint8Array([0]))
    .update(canonicalBytes)
    .digest("hex");
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isGenuineUint8Array(value: unknown): value is Uint8Array {
  return (
    value !== null &&
    typeof value === "object" &&
    !nodeUtilTypes.isProxy(value) &&
    nodeUtilTypes.isUint8Array(value) &&
    Object.getPrototypeOf(value) === Uint8Array.prototype
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !nodeUtilTypes.isProxy(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function freezePlainGraph<T>(value: T): T {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const child of value) freezePlainGraph(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezePlainGraph(child);
    }
  }
  return Object.freeze(value);
}

function requireSha256(value: unknown, issue: ScreenEvidenceTask1SealIssueCodeV1): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) return fail(issue);
  return value;
}

function requireSafeInteger(
  value: unknown,
  issue: ScreenEvidenceTask1SealIssueCodeV1,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(issue);
  return value as number;
}

function validateWindow(input: SealScreenEvidenceTask1EvaluationInputV1Input): void {
  const start = requireSafeInteger(input.structured.startEpochSecond, "WINDOW_INVALID");
  const end = requireSafeInteger(input.structured.endEpochSecond, "WINDOW_INVALID");
  const asOf = requireSafeInteger(input.structured.asOfEpochSecond, "WINDOW_INVALID");
  if (end !== start + 599 || asOf !== end) return fail("WINDOW_INVALID");
  const startMs = start * 1_000;
  const endMs = end * 1_000;
  if (
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    input.screen.startEpochMs !== startMs ||
    input.screen.endEpochMs !== endMs
  ) {
    return fail("WINDOW_INVALID");
  }
}

function validateStructured(
  structured: StructuredEvidenceTask1InputV1,
): Readonly<{ bytes: Uint8Array; rawSha256: string; contentSha256: string }> {
  if (!isPlainRecord(structured) || !isGenuineUint8Array(structured.bytes)) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  const bytes = copyBytes(structured.bytes);
  const byteLength = requireSafeInteger(
    structured.byteLength,
    "STRUCTURED_EVIDENCE_INVALID",
  );
  const rawSha256 = requireSha256(
    structured.rawSha256,
    "STRUCTURED_EVIDENCE_INVALID",
  );
  const contentSha256 = requireSha256(
    structured.contentSha256,
    "STRUCTURED_EVIDENCE_INVALID",
  );
  if (
    bytes.byteLength === 0 ||
    byteLength !== bytes.byteLength ||
    sha256(bytes) !== rawSha256
  ) {
    return fail("STRUCTURED_EVIDENCE_INVALID");
  }
  return Object.freeze({ bytes, rawSha256, contentSha256 });
}

function copyScreenEntries(
  readback: ScreenEvidenceTask1ReadbackV1,
): Readonly<{ bundleDirectoryName: string; files: readonly OwnedScreenSourceFile[] }> {
  if (
    readback === null ||
    typeof readback !== "object" ||
    nodeUtilTypes.isProxy(readback) ||
    typeof readback.copySourceEntries !== "function"
  ) {
    return fail("SCREEN_EVIDENCE_INVALID");
  }
  let source: ReturnType<ScreenEvidenceTask1ReadbackV1["copySourceEntries"]>;
  let confirmation: ReturnType<ScreenEvidenceTask1ReadbackV1["copySourceEntries"]>;
  try {
    source = readback.copySourceEntries();
    confirmation = readback.copySourceEntries();
  } catch {
    return fail("SCREEN_EVIDENCE_INVALID");
  }
  if (
    !isPlainRecord(source) ||
    !isPlainRecord(confirmation) ||
    typeof source.bundleDirectoryName !== "string" ||
    !SAFE_ID.test(source.bundleDirectoryName) ||
    source.bundleDirectoryName !== confirmation.bundleDirectoryName ||
    !Array.isArray(source.entries) ||
    !Array.isArray(confirmation.entries) ||
    source.entries.length !== SCREEN_SOURCE_FILES.length ||
    confirmation.entries.length !== SCREEN_SOURCE_FILES.length
  ) {
    return fail("SCREEN_EVIDENCE_INVALID");
  }
  const files: OwnedScreenSourceFile[] = [];
  for (let index = 0; index < SCREEN_SOURCE_FILES.length; index += 1) {
    const expected = SCREEN_SOURCE_FILES[index]!;
    const entry = source.entries[index];
    const repeated = confirmation.entries[index];
    if (
      entry === undefined ||
      repeated === undefined ||
      entry.relativePath !== expected.sourceRelativePath ||
      repeated.relativePath !== expected.sourceRelativePath ||
      entry.entryKind !== "regular-file" ||
      repeated.entryKind !== "regular-file" ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength < 1 ||
      entry.byteLength !== repeated.byteLength ||
      !isGenuineUint8Array(entry.bytes) ||
      !isGenuineUint8Array(repeated.bytes) ||
      entry.bytes.byteLength !== entry.byteLength ||
      repeated.bytes.byteLength !== repeated.byteLength ||
      !equalBytes(entry.bytes, repeated.bytes)
    ) {
      return fail("SCREEN_EVIDENCE_INVALID");
    }
    const bytes = copyBytes(entry.bytes);
    files.push(
      Object.freeze({
        sourceRelativePath: expected.sourceRelativePath,
        storedRelativePath: expected.storedRelativePath,
        mediaType: expected.mediaType,
        bytes,
        byteLength: bytes.byteLength,
        rawSha256: sha256(bytes),
      }),
    );
  }
  return Object.freeze({
    bundleDirectoryName: source.bundleDirectoryName,
    files: Object.freeze(files),
  });
}

function dataProperty(recordValue: unknown, property: string): unknown {
  if (!isPlainRecord(recordValue)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(recordValue, property);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function crossCheckReadbackScalar(
  readback: ScreenEvidenceTask1ReadbackV1,
  property: string,
  expected: string | number,
): void {
  const containers = [
    readback,
    dataProperty(readback, "descriptor"),
    dataProperty(readback, "evidence"),
  ];
  let observed = false;
  for (const container of containers) {
    const value = dataProperty(container, property);
    if (value !== undefined) {
      observed = true;
      if (value !== expected) return fail("SCREEN_EVIDENCE_INVALID");
    }
  }
  void observed;
}

function validateScreen(
  screen: ScreenEvidenceTask1SourceInputV1,
): Readonly<{
  bundleDirectoryName: string;
  sourceRevision: number;
  manifestSha256: string;
  payloadSha256: string;
  replayIdentitySha256: string;
  files: readonly OwnedScreenSourceFile[];
}> {
  if (!isPlainRecord(screen)) return fail("SCREEN_EVIDENCE_INVALID");
  const sourceRevision = requireSafeInteger(
    screen.sourceRevision,
    "SCREEN_EVIDENCE_INVALID",
  );
  if (sourceRevision < 1) return fail("SCREEN_EVIDENCE_INVALID");
  const manifestSha256 = requireSha256(
    screen.manifestSha256,
    "SCREEN_EVIDENCE_INVALID",
  );
  const payloadSha256 = requireSha256(
    screen.payloadSha256,
    "SCREEN_EVIDENCE_INVALID",
  );
  const replayIdentitySha256 = requireSha256(
    screen.replayIdentitySha256,
    "SCREEN_EVIDENCE_INVALID",
  );
  const source = copyScreenEntries(screen.readback);
  if (
    source.files[0]!.rawSha256 !== payloadSha256 ||
    source.files[1]!.rawSha256 !== manifestSha256
  ) {
    return fail("SCREEN_EVIDENCE_INVALID");
  }
  crossCheckReadbackScalar(screen.readback, "sourceRevision", sourceRevision);
  crossCheckReadbackScalar(screen.readback, "manifestSha256", manifestSha256);
  crossCheckReadbackScalar(screen.readback, "payloadSha256", payloadSha256);
  crossCheckReadbackScalar(
    screen.readback,
    "replayIdentitySha256",
    replayIdentitySha256,
  );
  return Object.freeze({
    bundleDirectoryName: source.bundleDirectoryName,
    sourceRevision,
    manifestSha256,
    payloadSha256,
    replayIdentitySha256,
    files: source.files,
  });
}

function validateSelection(
  selection: ScreenEvidenceTask1SelectionInputV1,
): ScreenEvidenceTask1SelectionDescriptorV1 {
  if (!isPlainRecord(selection)) return fail("SELECTION_INVALID");
  return Object.freeze({
    schemaVersion: SCREEN_EVIDENCE_TASK1_SELECTION_SCHEMA_V1,
    sourceSnapshotIdentitySha256: requireSha256(
      selection.sourceSnapshotIdentitySha256,
      "SELECTION_INVALID",
    ),
    privacyReceiptSetSha256: requireSha256(
      selection.privacyReceiptSetSha256,
      "SELECTION_INVALID",
    ),
    retentionAsOfEpochMs: requireSafeInteger(
      selection.retentionAsOfEpochMs,
      "SELECTION_INVALID",
    ),
  });
}

function makeArtifactFile(
  relativePath: string,
  mediaType: string,
  sourceBytes: Uint8Array,
): PrivateEvaluationArtifactSetFile {
  const bytes = copyBytes(sourceBytes);
  return Object.freeze({
    relativePath,
    mediaType,
    byteLength: bytes.byteLength,
    rawSha256: sha256(bytes),
    bytes,
  });
}

function copyArtifactFiles(
  files: readonly PrivateEvaluationArtifactSetFile[],
): readonly PrivateEvaluationArtifactSetFile[] {
  return Object.freeze(
    files.map((file) => makeArtifactFile(file.relativePath, file.mediaType, file.bytes)),
  );
}

function buildSeal(input: SealScreenEvidenceTask1EvaluationInputV1Input): Readonly<{
  inputRunId: string;
  manifest: ScreenEvidenceTask1EvaluationInputManifestV1;
  inputIdentitySha256: string;
  manifestRawSha256: string;
  files: readonly PrivateEvaluationArtifactSetFile[];
}> {
  if (!isPlainRecord(input) || typeof input.projectDirectory !== "string") {
    return fail("INPUT_INVALID");
  }
  if (typeof input.inputRunId !== "string" || !SAFE_ID.test(input.inputRunId)) {
    return fail("INPUT_INVALID");
  }
  if (!isPlainRecord(input.structured) || !isPlainRecord(input.screen)) {
    return fail("INPUT_INVALID");
  }
  validateWindow(input);
  const structured = validateStructured(input.structured);
  const screen = validateScreen(input.screen);
  const selection = validateSelection(input.selection);
  const sourceFiles = Object.freeze(
    screen.files.map((file) =>
      Object.freeze({
        sourceRelativePath: file.sourceRelativePath,
        storedRelativePath: file.storedRelativePath,
        byteLength: file.byteLength,
        rawSha256: file.rawSha256,
      }),
    ),
  );
  const manifestPreimage = freezePlainGraph({
    schemaVersion: SCREEN_EVIDENCE_TASK1_INPUT_MANIFEST_SCHEMA_V1,
    inputRunId: input.inputRunId,
    window: {
      startEpochSecond: input.structured.startEpochSecond,
      endEpochSecond: input.structured.endEpochSecond,
      durationSeconds: 600 as const,
      semantics: "inclusive" as const,
      screenStartEpochMs: input.screen.startEpochMs,
      screenEndEpochMs: input.screen.endEpochMs,
    },
    structuredEvidence: {
      storedRelativePath: "structured-evidence.json" as const,
      byteLength: structured.bytes.byteLength,
      rawSha256: structured.rawSha256,
      contentSha256: structured.contentSha256,
      asOfEpochSecond: input.structured.asOfEpochSecond,
    },
    screenEvidence: {
      bundleDirectoryName: screen.bundleDirectoryName,
      sourceRevision: screen.sourceRevision,
      manifestSha256: screen.manifestSha256,
      payloadSha256: screen.payloadSha256,
      replayIdentitySha256: screen.replayIdentitySha256,
      sourceFiles,
    },
    selection: {
      ...selection,
      storedRelativePath: "selection-descriptor.json" as const,
    },
    canonicalization: {
      json: "rfc8785-jcs.utf8.v1" as const,
      identityHashDomain: SCREEN_EVIDENCE_TASK1_INPUT_IDENTITY_DOMAIN_V1,
      identityPreimage:
        "utf8-domain-nul-canonical-manifest-without-input-identity.v1" as const,
    },
  });
  const inputIdentitySha256 = domainSeparatedSha256(
    SCREEN_EVIDENCE_TASK1_INPUT_IDENTITY_DOMAIN_V1,
    canonicalPrivateScreenEvidenceJsonBytesV1(manifestPreimage),
  );
  const manifest = freezePlainGraph<ScreenEvidenceTask1EvaluationInputManifestV1>({
    ...manifestPreimage,
    inputIdentitySha256,
  });
  const selectionBytes = canonicalPrivateScreenEvidenceJsonBytesV1(selection);
  const manifestBytes = canonicalPrivateScreenEvidenceJsonBytesV1(manifest);
  const manifestRawSha256 = sha256(manifestBytes);
  const markerBytes = textEncoder.encode(manifestRawSha256);
  const files = Object.freeze([
    makeArtifactFile("structured-evidence.json", "application/json", structured.bytes),
    ...screen.files.map((file) =>
      makeArtifactFile(file.storedRelativePath, file.mediaType, file.bytes),
    ),
    makeArtifactFile(
      "selection-descriptor.json",
      "application/json",
      selectionBytes,
    ),
    makeArtifactFile(
      "evaluation-input-manifest.json",
      "application/json",
      manifestBytes,
    ),
    makeArtifactFile(
      "evaluation-input-manifest.sha256",
      "text/plain; charset=us-ascii",
      markerBytes,
    ),
    makeArtifactFile(
      "COMPLETE",
      "text/plain; charset=us-ascii",
      markerBytes,
    ),
  ]);
  return Object.freeze({
    inputRunId: input.inputRunId,
    manifest,
    inputIdentitySha256,
    manifestRawSha256,
    files,
  });
}

export async function sealTask1EvaluationInputV1(
  input: SealScreenEvidenceTask1EvaluationInputV1Input,
): Promise<SealedScreenEvidenceTask1EvaluationInputV1> {
  let built: ReturnType<typeof buildSeal>;
  try {
    built = buildSeal(input);
  } catch (error) {
    if (error instanceof ScreenEvidenceTask1SealErrorV1) throw error;
    return fail("INPUT_INVALID");
  }

  let verified: VerifiedPrivateEvaluationArtifactSet;
  try {
    verified = await publishPrivateEvaluationArtifactSetNoClobber({
      dataRoot: input.projectDirectory,
      pathComponents: Object.freeze([
        ".local",
        "evaluations",
        "screen-evidence-ablation",
        "task1-inputs",
        built.inputRunId,
      ]),
      files: copyArtifactFiles(built.files),
    });
  } catch {
    return fail("PUBLICATION_FAILED");
  }

  const retainedFiles = copyArtifactFiles(built.files);
  return Object.freeze({
    relativeDirectory: verified.relativeDirectory,
    directoryMode: verified.directoryMode,
    inputIdentitySha256: built.inputIdentitySha256,
    manifestRawSha256: built.manifestRawSha256,
    manifest: built.manifest,
    files: Object.freeze(
      verified.files.map((file) => Object.freeze({ ...file })),
    ),
    copyFiles: () => copyArtifactFiles(retainedFiles),
  });
}
