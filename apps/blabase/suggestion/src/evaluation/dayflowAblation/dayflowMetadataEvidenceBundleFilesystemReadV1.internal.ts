import { AsyncLocalStorage as DayflowFilesystemReadAsyncLocalStorage } from "node:async_hooks";
import { basename as dayflowFilesystemReadBasename } from "node:path";
import { createHash } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { types as nodeUtilTypes } from "node:util";

import {
  DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1,
  type DayflowMetadataEvidenceBundleEntryV1,
} from "./dayflowMetadataEvidenceBundleQualificationV1.internal";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectKeys = Object.keys;
const objectPrototype = Object.prototype;
const arrayIsArray = Array.isArray;
const uint8ArraySet = Uint8Array.prototype.set;

export const DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1 = objectFreeze([
  "payload.json",
  "manifest.json",
  "manifest.sha256",
  "COMPLETE",
] as const);

export const DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1 = objectFreeze({
  "payload.json": DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.payloadBytes,
  "manifest.json": DAYFLOW_METADATA_EVIDENCE_IMPORT_LIMITS_V1.manifestBytes,
  "manifest.sha256": 64,
  COMPLETE: 64,
});

export type DayflowMetadataEvidenceBundleSourcePathV1 =
  (typeof DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1)[number];

export interface DayflowMetadataEvidenceBundleSourceFileV1 {
  readonly relativePath: DayflowMetadataEvidenceBundleSourcePathV1;
  readonly entryKind: "regular-file";
  readonly byteLength: number;
  readonly rawSha256: string;
}

export interface ReadDayflowMetadataEvidenceBundleFilesystemV1Input {
  readonly outputRoot: string;
  readonly bundleDirectoryName: string;
}

export interface ReadDayflowMetadataEvidenceBundleFilesystemV1Result {
  readonly sourceFiles: readonly DayflowMetadataEvidenceBundleSourceFileV1[];
  copySourceEntries(): readonly DayflowMetadataEvidenceBundleEntryV1[];
}

export type DayflowMetadataEvidenceFilesystemReadIssueCodeV1 =
  | "FILESYSTEM_INPUT_INVALID"
  | "OUTPUT_ROOT_UNSAFE"
  | "BUNDLE_DIRECTORY_UNSAFE"
  | "BUNDLE_INCOMPLETE"
  | "ENTRY_SET_MISMATCH"
  | "FILE_UNSAFE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "FILE_UNSTABLE"
  | "FILESYSTEM_REJECTED";

export class DayflowMetadataEvidenceFilesystemReadErrorV1 extends Error {
  readonly issueCode: DayflowMetadataEvidenceFilesystemReadIssueCodeV1;

  constructor(issueCode: DayflowMetadataEvidenceFilesystemReadIssueCodeV1) {
    super(`Dayflow metadata evidence filesystem read failed: ${issueCode}`);
    this.name = "DayflowMetadataEvidenceFilesystemReadErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: DayflowMetadataEvidenceFilesystemReadIssueCodeV1): never {
  throw new DayflowMetadataEvidenceFilesystemReadErrorV1(issueCode);
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    arrayIsArray(value) ||
    nodeUtilTypes.isProxy(value)
  ) {
    return false;
  }
  try {
    const prototype = objectGetPrototypeOf(value);
    return prototype === objectPrototype || prototype === null;
  } catch {
    return false;
  }
}

function snapshotInput(
  candidate: unknown,
): ReadDayflowMetadataEvidenceBundleFilesystemV1Input {
  if (!isSafeRecord(candidate)) {
    return fail("FILESYSTEM_INPUT_INVALID");
  }
  let descriptors: ReturnType<typeof objectGetOwnPropertyDescriptors>;
  try {
    descriptors = objectGetOwnPropertyDescriptors(candidate);
  } catch {
    return fail("FILESYSTEM_INPUT_INVALID");
  }
  const keys = objectKeys(descriptors);
  const expected = ["bundleDirectoryName", "outputRoot"];
  if (
    keys.length !== expected.length ||
    !expected.every((key) => keys.includes(key))
  ) {
    return fail("FILESYSTEM_INPUT_INVALID");
  }
  const root = descriptors.outputRoot;
  const name = descriptors.bundleDirectoryName;
  if (
    root === undefined ||
    !("value" in root) ||
    typeof root.value !== "string" ||
    name === undefined ||
    !("value" in name) ||
    typeof name.value !== "string"
  ) {
    return fail("FILESYSTEM_INPUT_INVALID");
  }
  return { outputRoot: root.value, bundleDirectoryName: name.value };
}

function copyBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  Reflect.apply(uint8ArraySet, copy, [source]);
  return copy;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function permissions(metadata: Stats): number {
  return metadata.mode & 0o777;
}

function sameMetadata(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function expectedCap(relativePath: DayflowMetadataEvidenceBundleSourcePathV1) {
  switch (relativePath) {
    case "payload.json":
      return DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1["payload.json"];
    case "manifest.json":
      return DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1["manifest.json"];
    case "manifest.sha256":
      return DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1["manifest.sha256"];
    case "COMPLETE":
      return DAYFLOW_METADATA_EVIDENCE_BUNDLE_READ_LIMITS_V1.COMPLETE;
  }
}

async function lstatChecked(
  target: string,
  missingCode: DayflowMetadataEvidenceFilesystemReadIssueCodeV1,
): Promise<Stats> {
  try {
    return await lstat(target);
  } catch {
    return fail(missingCode);
  }
}

async function readStableRegularFile(
  absolutePath: string,
  expectedOwner: number,
  maxBytes: number,
): Promise<Uint8Array> {
  const before = await lstatChecked(absolutePath, "ENTRY_SET_MISMATCH");
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.uid !== expectedOwner ||
    permissions(before) !== 0o600
  ) {
    return fail("FILE_UNSAFE");
  }
  if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameMetadata(before, opened)) {
      return fail("FILE_UNSTABLE");
    }
    const buffer = await handle.readFile();
    await dayflowMetadataEvidenceFilesystemReadHooksV1.getStore()?.afterFileRead?.(
      dayflowFilesystemReadBasename(absolutePath) as DayflowMetadataEvidenceBundleSourcePathV1,
    );
    const after = await handle.stat();
    if (
      buffer.byteLength !== before.size ||
      buffer.byteLength > maxBytes ||
      !sameMetadata(opened, after)
    ) {
      return fail("FILE_UNSTABLE");
    }
    return copyBytes(buffer);
  } catch (error) {
    if (error instanceof DayflowMetadataEvidenceFilesystemReadErrorV1) {
      throw error;
    }
    return fail("FILE_UNSAFE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readInternal(
  input: ReadDayflowMetadataEvidenceBundleFilesystemV1Input,
): Promise<ReadDayflowMetadataEvidenceBundleFilesystemV1Result> {
  const { outputRoot, bundleDirectoryName } = snapshotInput(input);
  if (
    !path.isAbsolute(outputRoot) ||
    path.normalize(outputRoot) !== outputRoot ||
    path.resolve(outputRoot) !== outputRoot
  ) {
    return fail("OUTPUT_ROOT_UNSAFE");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(bundleDirectoryName)) {
    return fail("BUNDLE_DIRECTORY_UNSAFE");
  }
  const getuid = process.getuid;
  if (typeof getuid !== "function") {
    return fail("OUTPUT_ROOT_UNSAFE");
  }
  const owner = getuid();
  const rootBefore = await lstatChecked(outputRoot, "OUTPUT_ROOT_UNSAFE");
  if (
    !rootBefore.isDirectory() ||
    rootBefore.isSymbolicLink() ||
    rootBefore.uid !== owner ||
    permissions(rootBefore) !== 0o700
  ) {
    return fail("OUTPUT_ROOT_UNSAFE");
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(outputRoot);
  } catch {
    return fail("OUTPUT_ROOT_UNSAFE");
  }
  if (canonicalRoot !== outputRoot) {
    return fail("OUTPUT_ROOT_UNSAFE");
  }
  const bundlePath = path.join(outputRoot, bundleDirectoryName);
  if (path.dirname(bundlePath) !== outputRoot) {
    return fail("BUNDLE_DIRECTORY_UNSAFE");
  }
  const bundleBefore = await lstatChecked(bundlePath, "BUNDLE_INCOMPLETE");
  if (
    !bundleBefore.isDirectory() ||
    bundleBefore.isSymbolicLink() ||
    bundleBefore.uid !== owner ||
    permissions(bundleBefore) !== 0o700
  ) {
    return fail("BUNDLE_DIRECTORY_UNSAFE");
  }
  let names: string[];
  try {
    names = await readdir(bundlePath);
  } catch {
    return fail("BUNDLE_INCOMPLETE");
  }
  const expected = [...DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1].sort();
  const actual = [...names].sort();
  if (!names.includes("COMPLETE")) {
    return fail("BUNDLE_INCOMPLETE");
  }
  if (
    actual.length !== expected.length ||
    !expected.every((name, index) => name === actual[index])
  ) {
    return fail("ENTRY_SET_MISMATCH");
  }
  const retained = new Map<DayflowMetadataEvidenceBundleSourcePathV1, Uint8Array>();
  const sourceFiles: DayflowMetadataEvidenceBundleSourceFileV1[] = [];
  for (const relativePath of DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1) {
    const bytes = await readStableRegularFile(
      path.join(bundlePath, relativePath),
      owner,
      expectedCap(relativePath),
    );
    retained.set(relativePath, bytes);
    sourceFiles.push(
      objectFreeze({
        relativePath,
        entryKind: "regular-file" as const,
        byteLength: bytes.byteLength,
        rawSha256: sha256(bytes),
      }),
    );
  }
  let namesAfter: string[];
  try {
    namesAfter = await readdir(bundlePath);
  } catch {
    return fail("FILE_UNSTABLE");
  }
  const bundleAfter = await lstatChecked(bundlePath, "FILE_UNSTABLE");
  if (
    !sameMetadata(bundleBefore, bundleAfter) ||
    [...namesAfter].sort().join("\0") !== actual.join("\0")
  ) {
    return fail("FILE_UNSTABLE");
  }
  const frozenSourceFiles = objectFreeze(sourceFiles);
  const copySourceEntries = () =>
    objectFreeze(
      DAYFLOW_METADATA_EVIDENCE_BUNDLE_SOURCE_ORDER_V1.map((relativePath) => {
        const bytes = retained.get(relativePath);
        if (bytes === undefined) {
          return fail("FILESYSTEM_REJECTED");
        }
        return objectFreeze({
          relativePath,
          entryKind: "regular-file" as const,
          byteLength: bytes.byteLength,
          bytes: copyBytes(bytes),
        });
      }),
    );
  return objectFreeze({ sourceFiles: frozenSourceFiles, copySourceEntries });
}

export async function readDayflowMetadataEvidenceBundleFilesystemV1Internal(
  input: ReadDayflowMetadataEvidenceBundleFilesystemV1Input,
  hooks?: DayflowMetadataEvidenceFilesystemReadHooksV1,
): Promise<ReadDayflowMetadataEvidenceBundleFilesystemV1Result> {
  if (hooks !== undefined) {
    return dayflowMetadataEvidenceFilesystemReadHooksV1.run(hooks, () =>
      readDayflowMetadataEvidenceBundleFilesystemV1Internal(input),
    );
  }

  try {
    return await readInternal(input);
  } catch (error) {
    if (error instanceof DayflowMetadataEvidenceFilesystemReadErrorV1) {
      throw error;
    }
    return fail("FILESYSTEM_REJECTED");
  }
}


export type DayflowMetadataEvidenceFilesystemReadHooksV1 = Readonly<{
  afterFileRead?: (
    relativePath: DayflowMetadataEvidenceBundleSourcePathV1,
  ) => Promise<void> | void;
}>;

const dayflowMetadataEvidenceFilesystemReadHooksV1 =
  new DayflowFilesystemReadAsyncLocalStorage<DayflowMetadataEvidenceFilesystemReadHooksV1>();
