import { createHash } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { types as nodeUtilTypes } from "node:util";

import {
  SCREEN_EVIDENCE_BUNDLE_FILES_V1,
  SCREEN_EVIDENCE_LIMITS_V1,
  type ScreenEvidenceBundleEntryV1,
  type ScreenEvidenceBundleFileV1,
  type ScreenEvidenceBundleInputV1,
} from "./contractsV1";
import {
  importScreenEvidenceBundleV1,
  ScreenEvidenceImportErrorV1,
  type ImportedScreenEvidenceBundleV1,
} from "./importScreenEvidenceBundleV1";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const arrayIsArray = Array.isArray;
const uint8ArraySet = Uint8Array.prototype.set;

export const SCREEN_EVIDENCE_READ_SCHEMA_VERSION_V1 =
  "blabase.screen-evidence-read.v1" as const;

export type ScreenEvidenceReadIssueCodeV1 =
  | "BUNDLE_INPUT_INVALID"
  | "BUNDLE_DIRECTORY_UNSAFE"
  | "BUNDLE_INCOMPLETE"
  | "ENTRY_SET_MISMATCH"
  | "FILE_UNSAFE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "FILE_UNSTABLE"
  | "IMPORT_REJECTED"
  | "FILESYSTEM_REJECTED";

export class ScreenEvidenceReadErrorV1 extends Error {
  readonly issueCode: ScreenEvidenceReadIssueCodeV1;

  constructor(issueCode: ScreenEvidenceReadIssueCodeV1) {
    super(`Screen evidence bundle read failed (${issueCode})`);
    this.name = "ScreenEvidenceReadErrorV1";
    this.issueCode = issueCode;
  }
}

export interface ReadScreenEvidenceBundleV1Input {
  readonly bundleDirectory: string;
}

export interface ScreenEvidenceSourceFileV1 {
  readonly relativePath: ScreenEvidenceBundleFileV1;
  readonly entryKind: "regular-file";
  readonly byteLength: number;
  readonly rawSha256: string;
}

export type CopyScreenEvidenceSourceEntriesV1 =
  () => ScreenEvidenceBundleInputV1;

export interface ReadScreenEvidenceBundleV1Result {
  readonly readDescriptor: Readonly<{
    readSchemaVersion: typeof SCREEN_EVIDENCE_READ_SCHEMA_VERSION_V1;
    bundleDirectoryName: string;
    sourceOrder: typeof SCREEN_EVIDENCE_BUNDLE_FILES_V1;
  }>;
  readonly imported: ImportedScreenEvidenceBundleV1;
  readonly sourceFiles: readonly ScreenEvidenceSourceFileV1[];
  readonly copySourceEntries: CopyScreenEvidenceSourceEntriesV1;
}

function fail(issueCode: ScreenEvidenceReadIssueCodeV1): never {
  throw new ScreenEvidenceReadErrorV1(issueCode);
}

function snapshotInput(candidate: unknown): ReadScreenEvidenceBundleV1Input {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    arrayIsArray(candidate) ||
    nodeUtilTypes.isProxy(candidate) ||
    objectGetPrototypeOf(candidate) !== Object.prototype
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const descriptors = objectGetOwnPropertyDescriptors(candidate);
  const keys = Reflect.ownKeys(descriptors);
  const directory = descriptors.bundleDirectory;
  if (
    keys.length !== 1 ||
    keys[0] !== "bundleDirectory" ||
    directory === undefined ||
    !("value" in directory) ||
    typeof directory.value !== "string"
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  const bundleDirectory = directory.value;
  if (
    !path.isAbsolute(bundleDirectory) ||
    path.normalize(bundleDirectory) !== bundleDirectory ||
    path.resolve(bundleDirectory) !== bundleDirectory
  ) {
    return fail("BUNDLE_INPUT_INVALID");
  }
  return { bundleDirectory };
}

function maximumBytes(relativePath: ScreenEvidenceBundleFileV1): number {
  switch (relativePath) {
    case "payload.json":
      return SCREEN_EVIDENCE_LIMITS_V1.payloadBytes;
    case "manifest.json":
      return SCREEN_EVIDENCE_LIMITS_V1.manifestBytes;
    case "manifest.sha256":
    case "COMPLETE":
      return SCREEN_EVIDENCE_LIMITS_V1.markerBytes;
  }
}

function permissions(stats: Stats): number {
  return stats.mode & 0o777;
}

function sameStats(left: Stats, right: Stats): boolean {
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

function copyBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  Reflect.apply(uint8ArraySet, copy, [source]);
  return copy;
}

async function checkedLstat(
  target: string,
  issueCode: ScreenEvidenceReadIssueCodeV1,
): Promise<Stats> {
  try {
    return await lstat(target);
  } catch {
    return fail(issueCode);
  }
}

function requirePrivateDirectory(stats: Stats, expectedOwner: number | undefined): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return fail("BUNDLE_DIRECTORY_UNSAFE");
  }
  if (
    expectedOwner !== undefined &&
    (stats.uid !== expectedOwner || permissions(stats) !== 0o700)
  ) {
    return fail("BUNDLE_DIRECTORY_UNSAFE");
  }
}

async function readStableFile(
  absolutePath: string,
  expectedOwner: number | undefined,
  maximumByteCount: number,
): Promise<Uint8Array> {
  const before = await checkedLstat(absolutePath, "ENTRY_SET_MISMATCH");
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    (expectedOwner !== undefined &&
      (before.uid !== expectedOwner || permissions(before) !== 0o600))
  ) {
    return fail("FILE_UNSAFE");
  }
  if (
    !Number.isSafeInteger(before.size) ||
    before.size < 0 ||
    before.size > maximumByteCount
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameStats(before, opened)) {
      return fail("FILE_UNSTABLE");
    }
    const buffer = new Uint8Array(opened.size + 1);
    let byteOffset = 0;
    while (byteOffset < buffer.byteLength) {
      const requestedByteCount = buffer.byteLength - byteOffset;
      const { bytesRead } = await handle.read(
        buffer,
        byteOffset,
        requestedByteCount,
        byteOffset,
      );
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > requestedByteCount
      ) {
        return fail("FILE_UNSTABLE");
      }
      if (bytesRead === 0) break;
      byteOffset += bytesRead;
    }
    const after = await handle.stat();
    if (
      byteOffset !== opened.size ||
      !sameStats(opened, after)
    ) {
      return fail("FILE_UNSTABLE");
    }
    return copyBytes(new Uint8Array(buffer.buffer, buffer.byteOffset, opened.size));
  } catch (error) {
    if (error instanceof ScreenEvidenceReadErrorV1) throw error;
    return fail("FILE_UNSAFE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((name, index) => name === sortedRight[index])
  );
}

function createSourceEntryCopier(
  bundleDirectoryName: string,
  sourceEntries: readonly ScreenEvidenceBundleEntryV1[],
): CopyScreenEvidenceSourceEntriesV1 {
  const copySourceEntries: CopyScreenEvidenceSourceEntriesV1 = () =>
    objectFreeze({
      bundleDirectoryName,
      entries: objectFreeze(
        sourceEntries.map((entry) =>
          objectFreeze({
            relativePath: entry.relativePath,
            entryKind: "regular-file" as const,
            byteLength: entry.byteLength,
            bytes: copyBytes(entry.bytes),
          }),
        ),
      ),
    });
  return objectFreeze(copySourceEntries);
}

export async function readScreenEvidenceBundleV1(
  input: ReadScreenEvidenceBundleV1Input,
): Promise<ReadScreenEvidenceBundleV1Result> {
  try {
    const { bundleDirectory } = snapshotInput(input);
    const bundleDirectoryName = path.basename(bundleDirectory);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(bundleDirectoryName)) {
      return fail("BUNDLE_DIRECTORY_UNSAFE");
    }
    const expectedOwner = typeof process.getuid === "function" ? process.getuid() : undefined;
    const directoryBefore = await checkedLstat(bundleDirectory, "BUNDLE_INCOMPLETE");
    requirePrivateDirectory(directoryBefore, expectedOwner);
    let canonicalDirectory: string;
    try {
      canonicalDirectory = await realpath(bundleDirectory);
    } catch {
      return fail("BUNDLE_DIRECTORY_UNSAFE");
    }
    if (canonicalDirectory !== bundleDirectory) return fail("BUNDLE_DIRECTORY_UNSAFE");

    let namesBefore: string[];
    try {
      namesBefore = await readdir(bundleDirectory);
    } catch {
      return fail("BUNDLE_INCOMPLETE");
    }
    if (!namesBefore.includes("COMPLETE")) return fail("BUNDLE_INCOMPLETE");
    if (!sameNames(namesBefore, SCREEN_EVIDENCE_BUNDLE_FILES_V1)) {
      return fail("ENTRY_SET_MISMATCH");
    }

    const entries: ScreenEvidenceBundleEntryV1[] = [];
    const sourceFiles: ScreenEvidenceSourceFileV1[] = [];
    for (const relativePath of SCREEN_EVIDENCE_BUNDLE_FILES_V1) {
      const absolutePath = path.join(bundleDirectory, relativePath);
      if (path.dirname(absolutePath) !== bundleDirectory) return fail("FILE_UNSAFE");
      const bytes = await readStableFile(
        absolutePath,
        expectedOwner,
        maximumBytes(relativePath),
      );
      entries.push(
        objectFreeze({
          relativePath,
          entryKind: "regular-file" as const,
          byteLength: bytes.byteLength,
          bytes: copyBytes(bytes),
        }),
      );
      sourceFiles.push(
        objectFreeze({
          relativePath,
          entryKind: "regular-file" as const,
          byteLength: bytes.byteLength,
          rawSha256: createHash("sha256").update(bytes).digest("hex"),
        }),
      );
    }

    let namesAfter: string[];
    try {
      namesAfter = await readdir(bundleDirectory);
    } catch {
      return fail("FILE_UNSTABLE");
    }
    const directoryAfter = await checkedLstat(bundleDirectory, "FILE_UNSTABLE");
    if (
      !sameStats(directoryBefore, directoryAfter) ||
      !sameNames(namesBefore, namesAfter)
    ) {
      return fail("FILE_UNSTABLE");
    }

    const imported = importScreenEvidenceBundleV1(
      objectFreeze({
        bundleDirectoryName,
        entries: objectFreeze(entries),
      }),
    );
    const copySourceEntries = createSourceEntryCopier(
      bundleDirectoryName,
      entries,
    );
    return objectFreeze({
      readDescriptor: objectFreeze({
        readSchemaVersion: SCREEN_EVIDENCE_READ_SCHEMA_VERSION_V1,
        bundleDirectoryName,
        sourceOrder: SCREEN_EVIDENCE_BUNDLE_FILES_V1,
      }),
      imported,
      sourceFiles: objectFreeze(sourceFiles),
      copySourceEntries,
    });
  } catch (error) {
    if (error instanceof ScreenEvidenceReadErrorV1) throw error;
    if (error instanceof ScreenEvidenceImportErrorV1) return fail("IMPORT_REJECTED");
    return fail("FILESYSTEM_REJECTED");
  }
}
