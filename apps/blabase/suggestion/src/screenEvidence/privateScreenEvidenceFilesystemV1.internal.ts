import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { types as nodeUtilTypes } from "node:util";

import { PRIVATE_SCREEN_EVIDENCE_LIMITS_V1 } from "./privateStoreContractsV1";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

export type PrivateScreenEvidenceFilesystemIssueCodeV1 =
  | "INPUT_INVALID"
  | "FILESYSTEM_UNSUPPORTED"
  | "DIRECTORY_MISSING"
  | "DIRECTORY_UNSAFE"
  | "ENTRY_MISSING"
  | "ENTRY_EXISTS"
  | "PRECOMMIT_CLEANUP_FAILURE"
  | "ENTRY_COMMITTED_FAILURE"
  | "FILE_UNSAFE"
  | "FILE_UNSTABLE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "CANONICAL_JSON_INVALID"
  | "CONTENT_MISMATCH"
  | "FILESYSTEM_REJECTED";

export class PrivateScreenEvidenceFilesystemErrorV1 extends Error {
  readonly issueCode: PrivateScreenEvidenceFilesystemIssueCodeV1;

  constructor(issueCode: PrivateScreenEvidenceFilesystemIssueCodeV1) {
    super(`Private screen evidence filesystem operation failed (${issueCode})`);
    this.name = "PrivateScreenEvidenceFilesystemErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: PrivateScreenEvidenceFilesystemIssueCodeV1): never {
  throw new PrivateScreenEvidenceFilesystemErrorV1(issueCode);
}

function currentOwner(): number {
  if (typeof process.getuid !== "function") return fail("FILESYSTEM_UNSUPPORTED");
  const owner = process.getuid();
  if (!Number.isSafeInteger(owner) || owner < 0) {
    return fail("FILESYSTEM_UNSUPPORTED");
  }
  return owner;
}

function requirePosixFlags(): Readonly<{
  noFollow: number;
  directory: number;
}> {
  if (
    typeof fsConstants.O_NOFOLLOW !== "number" ||
    typeof fsConstants.O_DIRECTORY !== "number"
  ) {
    return fail("FILESYSTEM_UNSUPPORTED");
  }
  return { noFollow: fsConstants.O_NOFOLLOW, directory: fsConstants.O_DIRECTORY };
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

function sameDirectoryIdentity(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.isDirectory() &&
    right.isDirectory()
  );
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function requireAbsoluteCanonicalPath(candidate: string): void {
  if (
    !path.isAbsolute(candidate) ||
    path.normalize(candidate) !== candidate ||
    path.resolve(candidate) !== candidate
  ) {
    return fail("INPUT_INVALID");
  }
}

async function checkedLstat(
  target: string,
  missingCode: "DIRECTORY_MISSING" | "ENTRY_MISSING",
): Promise<Stats> {
  try {
    return await lstat(target);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return fail(missingCode);
    return fail("FILESYSTEM_REJECTED");
  }
}

export async function requirePrivateScreenEvidenceProjectDirectoryV1(
  projectDirectory: string,
): Promise<void> {
  requireAbsoluteCanonicalPath(projectDirectory);
  const owner = currentOwner();
  const before = await checkedLstat(projectDirectory, "DIRECTORY_MISSING");
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== owner ||
    (permissions(before) & 0o022) !== 0
  ) {
    return fail("DIRECTORY_UNSAFE");
  }
  let canonical: string;
  try {
    canonical = await realpath(projectDirectory);
  } catch {
    return fail("DIRECTORY_UNSAFE");
  }
  if (canonical !== projectDirectory) return fail("DIRECTORY_UNSAFE");
  const after = await checkedLstat(projectDirectory, "DIRECTORY_MISSING");
  if (!sameDirectoryIdentity(before, after)) return fail("DIRECTORY_UNSAFE");
}

export async function requirePrivateScreenEvidenceDirectoryV1(
  directory: string,
): Promise<void> {
  requireAbsoluteCanonicalPath(directory);
  const owner = currentOwner();
  const before = await checkedLstat(directory, "DIRECTORY_MISSING");
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.uid !== owner ||
    permissions(before) !== 0o700
  ) {
    return fail("DIRECTORY_UNSAFE");
  }
  let canonical: string;
  try {
    canonical = await realpath(directory);
  } catch {
    return fail("DIRECTORY_UNSAFE");
  }
  if (canonical !== directory) return fail("DIRECTORY_UNSAFE");

  const { noFollow, directory: directoryFlag } = requirePosixFlags();
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, fsConstants.O_RDONLY | noFollow | directoryFlag);
    const opened = await handle.stat();
    if (!sameDirectoryIdentity(before, opened)) return fail("DIRECTORY_UNSAFE");
    const after = await checkedLstat(directory, "DIRECTORY_MISSING");
    if (!sameDirectoryIdentity(opened, after)) return fail("DIRECTORY_UNSAFE");
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("DIRECTORY_UNSAFE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function requireSafeChildName(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    path.basename(name) !== name ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    return fail("INPUT_INVALID");
  }
}

async function ensurePrivateScreenEvidenceChildDirectoryWithParentPolicyV1(
  parentDirectory: string,
  childName: string,
  parentPolicy: "project-root" | "private",
): Promise<string> {
  requireSafeChildName(childName);
  const child = path.join(parentDirectory, childName);
  if (path.dirname(child) !== parentDirectory) return fail("INPUT_INVALID");
  if (parentPolicy === "project-root") {
    await requirePrivateScreenEvidenceProjectDirectoryV1(parentDirectory);
  } else {
    await requirePrivateScreenEvidenceDirectoryV1(parentDirectory);
  }
  let created = false;
  try {
    await mkdir(child, { mode: 0o700 });
    created = true;
    await chmod(child, 0o700);
  } catch (error) {
    if (!isNodeErrorWithCode(error, "EEXIST")) return fail("FILESYSTEM_REJECTED");
  }
  await requirePrivateScreenEvidenceDirectoryV1(child);
  if (created) {
    if (parentPolicy === "project-root") {
      await fsyncPrivateScreenEvidenceProjectDirectoryV1(parentDirectory);
    } else {
      await fsyncPrivateScreenEvidenceDirectoryV1(parentDirectory);
    }
  }
  return child;
}

export async function ensurePrivateScreenEvidenceChildDirectoryV1(
  parentDirectory: string,
  childName: string,
): Promise<string> {
  return ensurePrivateScreenEvidenceChildDirectoryWithParentPolicyV1(
    parentDirectory,
    childName,
    "private",
  );
}

export async function ensurePrivateScreenEvidenceDirectoryChainV1(
  projectDirectory: string,
  finalDirectoryName: "store" | "exports",
): Promise<string> {
  await requirePrivateScreenEvidenceProjectDirectoryV1(projectDirectory);
  let current = await ensurePrivateScreenEvidenceChildDirectoryWithParentPolicyV1(
    projectDirectory,
    ".local",
    "project-root",
  );
  for (const component of ["screen-evidence", "v1", finalDirectoryName]) {
    current = await ensurePrivateScreenEvidenceChildDirectoryV1(current, component);
  }
  return current;
}

export async function requirePrivateScreenEvidenceDirectoryChainV1(
  projectDirectory: string,
  finalDirectoryName: "store" | "exports",
): Promise<string> {
  await requirePrivateScreenEvidenceProjectDirectoryV1(projectDirectory);
  let current = projectDirectory;
  for (const component of [".local", "screen-evidence", "v1", finalDirectoryName]) {
    current = path.join(current, component);
    await requirePrivateScreenEvidenceDirectoryV1(current);
  }
  return current;
}

function copyBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

export interface StablePrivateScreenEvidenceFileV1 {
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly rawSha256: string;
}

export async function readStablePrivateScreenEvidenceFileV1(
  absolutePath: string,
  maximumByteCount: number,
): Promise<StablePrivateScreenEvidenceFileV1> {
  requireAbsoluteCanonicalPath(absolutePath);
  if (
    !Number.isSafeInteger(maximumByteCount) ||
    maximumByteCount < 1 ||
    maximumByteCount >= Number.MAX_SAFE_INTEGER
  ) {
    return fail("INPUT_INVALID");
  }
  const owner = currentOwner();
  const before = await checkedLstat(absolutePath, "ENTRY_MISSING");
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== owner ||
    before.nlink !== 1 ||
    permissions(before) !== 0o600
  ) {
    return fail("FILE_UNSAFE");
  }
  if (
    !Number.isSafeInteger(before.size) ||
    before.size < 1 ||
    before.size > maximumByteCount
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }

  const { noFollow } = requirePosixFlags();
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolutePath, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameStats(before, opened)) {
      return fail("FILE_UNSTABLE");
    }
    const allocation = new Uint8Array(opened.size + 1);
    let offset = 0;
    while (offset < allocation.byteLength) {
      const requested = allocation.byteLength - offset;
      const { bytesRead } = await handle.read(allocation, offset, requested, offset);
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > requested
      ) {
        return fail("FILE_UNSTABLE");
      }
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const afterDescriptor = await handle.stat();
    const afterPath = await checkedLstat(absolutePath, "ENTRY_MISSING");
    if (
      offset !== opened.size ||
      !sameStats(opened, afterDescriptor) ||
      !sameStats(afterDescriptor, afterPath)
    ) {
      return fail("FILE_UNSTABLE");
    }
    const bytes = copyBytes(
      new Uint8Array(allocation.buffer, allocation.byteOffset, opened.size),
    );
    return objectFreeze({
      bytes,
      byteLength: bytes.byteLength,
      rawSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("FILE_UNSAFE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    );
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      return fail("FILESYSTEM_REJECTED");
    }
    offset += bytesWritten;
  }
}

async function createAndSyncPrivateFile(
  absolutePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const { noFollow } = requirePosixFlags();
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        noFollow,
      0o600,
    );
    await handle.chmod(0o600);
    await writeAll(handle, bytes);
    await handle.sync();
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    if (isNodeErrorWithCode(error, "EEXIST")) return fail("ENTRY_EXISTS");
    return fail("FILESYSTEM_REJECTED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

export async function fsyncPrivateScreenEvidenceDirectoryV1(
  directory: string,
): Promise<void> {
  return fsyncPrivateScreenEvidenceDirectoryWithPolicyV1(directory, "private");
}

async function fsyncPrivateScreenEvidenceProjectDirectoryV1(
  directory: string,
): Promise<void> {
  return fsyncPrivateScreenEvidenceDirectoryWithPolicyV1(
    directory,
    "project-root",
  );
}

async function fsyncPrivateScreenEvidenceDirectoryWithPolicyV1(
  directory: string,
  policy: "project-root" | "private",
): Promise<void> {
  if (policy === "project-root") {
    await requirePrivateScreenEvidenceProjectDirectoryV1(directory);
  } else {
    await requirePrivateScreenEvidenceDirectoryV1(directory);
  }
  const before = await checkedLstat(directory, "DIRECTORY_MISSING");
  const { noFollow, directory: directoryFlag } = requirePosixFlags();
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, fsConstants.O_RDONLY | noFollow | directoryFlag);
    const opened = await handle.stat();
    if (!sameDirectoryIdentity(before, opened)) {
      return fail("DIRECTORY_UNSAFE");
    }
    await handle.sync();
    const after = await checkedLstat(directory, "DIRECTORY_MISSING");
    if (!sameDirectoryIdentity(opened, after)) {
      return fail("DIRECTORY_UNSAFE");
    }
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("FILESYSTEM_REJECTED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function publishImmutablePrivateScreenEvidenceFileV1(
  directory: string,
  finalName: string,
  bytes: Uint8Array,
): Promise<StablePrivateScreenEvidenceFileV1> {
  requireSafeChildName(finalName);
  await requirePrivateScreenEvidenceDirectoryV1(directory);
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
  const tempName = `.tmp-${process.pid}-${randomBytes(16).toString("hex")}`;
  const tempPath = path.join(directory, tempName);
  const finalPath = path.join(directory, finalName);
  await createAndSyncPrivateFile(tempPath, bytes);
  const tempReadback = await readStablePrivateScreenEvidenceFileV1(
    tempPath,
    bytes.byteLength,
  );
  if (
    tempReadback.rawSha256 !== expectedHash ||
    !equalBytes(tempReadback.bytes, bytes)
  ) {
    return fail("CONTENT_MISMATCH");
  }
  try {
    await link(tempPath, finalPath);
  } catch (error) {
    const conflict = isNodeErrorWithCode(error, "EEXIST");
    try {
      await unlink(tempPath);
      await fsyncPrivateScreenEvidenceDirectoryV1(directory);
    } catch {
      return fail("PRECOMMIT_CLEANUP_FAILURE");
    }
    if (conflict) return fail("ENTRY_EXISTS");
    return fail("FILESYSTEM_REJECTED");
  }
  try {
    await unlink(tempPath);
  } catch {
    return fail("ENTRY_COMMITTED_FAILURE");
  }
  try {
    await fsyncPrivateScreenEvidenceDirectoryV1(directory);
    const finalReadback = await readStablePrivateScreenEvidenceFileV1(
      finalPath,
      bytes.byteLength,
    );
    if (
      finalReadback.rawSha256 !== expectedHash ||
      !equalBytes(finalReadback.bytes, bytes)
    ) {
      return fail("ENTRY_COMMITTED_FAILURE");
    }
    return finalReadback;
  } catch (error) {
    if (
      error instanceof PrivateScreenEvidenceFilesystemErrorV1 &&
      error.issueCode === "ENTRY_COMMITTED_FAILURE"
    ) {
      throw error;
    }
    return fail("ENTRY_COMMITTED_FAILURE");
  }
}

export async function writeNewPrivateScreenEvidenceFileV1(
  directory: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<StablePrivateScreenEvidenceFileV1> {
  requireSafeChildName(fileName);
  await requirePrivateScreenEvidenceDirectoryV1(directory);
  const absolutePath = path.join(directory, fileName);
  await createAndSyncPrivateFile(absolutePath, bytes);
  const readback = await readStablePrivateScreenEvidenceFileV1(
    absolutePath,
    bytes.byteLength,
  );
  if (!equalBytes(readback.bytes, bytes)) return fail("CONTENT_MISMATCH");
  return readback;
}

export async function createPrivateScreenEvidenceDirectoryNoClobberV1(
  parentDirectory: string,
  childName: string,
): Promise<string> {
  requireSafeChildName(childName);
  await requirePrivateScreenEvidenceDirectoryV1(parentDirectory);
  const child = path.join(parentDirectory, childName);
  try {
    await mkdir(child, { mode: 0o700 });
    await chmod(child, 0o700);
  } catch (error) {
    if (isNodeErrorWithCode(error, "EEXIST")) return fail("ENTRY_EXISTS");
    return fail("FILESYSTEM_REJECTED");
  }
  await requirePrivateScreenEvidenceDirectoryV1(child);
  await fsyncPrivateScreenEvidenceDirectoryV1(parentDirectory);
  return child;
}

export async function listPrivateScreenEvidenceDirectoryNamesV1(
  directory: string,
  maximumEntries: number,
): Promise<readonly string[]> {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) {
    return fail("INPUT_INVALID");
  }
  await requirePrivateScreenEvidenceDirectoryV1(directory);
  const before = await checkedLstat(directory, "DIRECTORY_MISSING");
  const names: string[] = [];
  try {
    const iterator = await opendir(directory);
    for await (const entry of iterator) {
      names.push(entry.name);
      if (names.length > maximumEntries) {
        return fail("RESOURCE_LIMIT_EXCEEDED");
      }
    }
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("FILESYSTEM_REJECTED");
  }
  const after = await checkedLstat(directory, "DIRECTORY_MISSING");
  if (!sameStats(before, after)) return fail("FILE_UNSTABLE");
  return objectFreeze(names.sort());
}

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return fail("CANONICAL_JSON_INVALID");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return fail("CANONICAL_JSON_INVALID");
    }
  }
}

interface JsonResourceBudget {
  nodes: number;
}

function canonicalJsonString(
  value: unknown,
  depth: number,
  budget: JsonResourceBudget,
): string {
  budget.nodes += 1;
  if (
    depth > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumDepth ||
    budget.nodes > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumGraphNodes
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      return fail("CANONICAL_JSON_INVALID");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertUnicodeScalars(value);
    if (
      textEncoder.encode(value).byteLength >
      PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes
    ) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return fail("CANONICAL_JSON_INVALID");
  if (arrayIsArray(value)) {
    if (value.length > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumArrayElements) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    return `[${value
      .map((child) => canonicalJsonString(child, depth + 1, budget))
      .join(",")}]`;
  }
  if (objectGetPrototypeOf(value) !== Object.prototype) {
    return fail("CANONICAL_JSON_INVALID");
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.length > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumObjectProperties ||
    keys.some((key) => typeof key !== "string")
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  const names = (keys as string[]).sort();
  const members: string[] = [];
  for (const key of names) {
    assertUnicodeScalars(key);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("CANONICAL_JSON_INVALID");
    }
    members.push(
      `${JSON.stringify(key)}:${canonicalJsonString(
        descriptor.value,
        depth + 1,
        budget,
      )}`,
    );
  }
  return `{${members.join(",")}}`;
}

export function canonicalPrivateScreenEvidenceJsonBytesV1(
  value: unknown,
): Uint8Array {
  try {
    return textEncoder.encode(canonicalJsonString(value, 0, { nodes: 0 }));
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("CANONICAL_JSON_INVALID");
  }
}

export function parseCanonicalPrivateScreenEvidenceJsonV1(
  bytes: Uint8Array,
): unknown {
  try {
    if (
      bytes.byteLength >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      return fail("CANONICAL_JSON_INVALID");
    }
    const source = fatalTextDecoder.decode(bytes);
    const value: unknown = JSON.parse(source);
    const canonical = canonicalPrivateScreenEvidenceJsonBytesV1(value);
    if (!equalBytes(canonical, bytes)) return fail("CANONICAL_JSON_INVALID");
    return value;
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("CANONICAL_JSON_INVALID");
  }
}

interface SnapshotBudget {
  nodes: number;
}

function snapshotStrictJson(
  value: unknown,
  depth: number,
  budget: SnapshotBudget,
): unknown {
  budget.nodes += 1;
  if (
    depth > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumDepth ||
    budget.nodes > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumGraphNodes
  ) {
    return fail("RESOURCE_LIMIT_EXCEEDED");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      return fail("INPUT_INVALID");
    }
    return value;
  }
  if (typeof value === "string") {
    assertUnicodeScalars(value);
    if (
      textEncoder.encode(value).byteLength >
      PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumStringBytes
    ) {
      return fail("RESOURCE_LIMIT_EXCEEDED");
    }
    return value;
  }
  if (
    typeof value !== "object" ||
    nodeUtilTypes.isProxy(value) ||
    (objectGetPrototypeOf(value) !== Object.prototype &&
      objectGetPrototypeOf(value) !== Array.prototype)
  ) {
    return fail("INPUT_INVALID");
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(descriptors);
  if (arrayIsArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value >
        PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumArrayElements
    ) {
      return fail("INPUT_INVALID");
    }
    const expected = new Set<string>(["length"]);
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      expected.add(String(index));
    }
    if (
      keys.length !== expected.size ||
      keys.some((key) => typeof key !== "string" || !expected.has(key))
    ) {
      return fail("INPUT_INVALID");
    }
    const result: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) {
        return fail("INPUT_INVALID");
      }
      result.push(snapshotStrictJson(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  if (
    keys.length > PRIVATE_SCREEN_EVIDENCE_LIMITS_V1.maximumObjectProperties ||
    keys.some((key) => typeof key !== "string")
  ) {
    return fail("INPUT_INVALID");
  }
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("INPUT_INVALID");
    }
    Object.defineProperty(result, key, {
      value: snapshotStrictJson(descriptor.value, depth + 1, budget),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

export function snapshotStrictPrivateScreenEvidenceJsonV1(
  value: unknown,
): unknown {
  try {
    return snapshotStrictJson(value, 0, { nodes: 0 });
  } catch (error) {
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) throw error;
    return fail("INPUT_INVALID");
  }
}

export function deepFreezePrivateScreenEvidenceV1<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) return value;
  if (arrayIsArray(value)) {
    for (const child of value) deepFreezePrivateScreenEvidenceV1(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezePrivateScreenEvidenceV1(child);
    }
  }
  return objectFreeze(value);
}
