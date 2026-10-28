import { constants as exactReadFsConstants } from "node:fs";
import {
  lstat as exactReadLstat,
  open as exactReadOpen,
  readdir as exactReadDirectoryEntries,
  realpath as exactReadRealpath,
} from "node:fs/promises";
import {
  isAbsolute as exactReadIsAbsolute,
  join as exactReadJoin,
  relative as exactReadRelative,
  resolve as exactReadResolve,
  sep as exactReadSeparator,
} from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { Stats } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  domainSeparatedSha256,
  jcsCanonicalize
} from "../dayflowEvidence/contracts";

const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

export function parseCanonicalJson<T>(
  bytes: Uint8Array,
  schema: { parse(value: unknown): T }
): T {
  const text = decodeUtf8(bytes);
  if (!text.endsWith("\n") || text.endsWith("\n\n") || text.includes("\r")) {
    throw new Error("DFA-002 JSON artifact is not canonical LF-framed data.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(0, -1));
  } catch {
    throw new Error("DFA-002 JSON artifact could not be parsed.");
  }
  const value = schema.parse(raw);
  if (!equalBytes(bytes, canonicalJsonLfBytes(value))) {
    throw new Error("DFA-002 JSON artifact is not canonical JCS+LF.");
  }
  return value;
}

export function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJsonLfBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${jcsCanonicalize(value)}\n`);
}

export function byteMapSnapshotSha256(
  domain: string,
  values: ReadonlyMap<string, Uint8Array>
): string {
  return domainSeparatedSha256(
    domain,
    [...values.entries()]
      .map(([relativePath, bytes]) => ({
        relativePath,
        byteLength: String(bytes.byteLength),
        rawSha256: rawSha256(bytes)
      }))
      .sort((left, right) => compareStrings(left.relativePath, right.relativePath))
  );
}

export function canonicalEqual(left: unknown, right: unknown): boolean {
  return jcsCanonicalize(left) === jcsCanonicalize(right);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return UTF8_FATAL.decode(bytes);
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9._+/-]+$/u;

export type LocalDfa002ReadHooks = Readonly<{
  afterRead?: (absolutePath: string) => Promise<void> | void;
}>;

export type PinnedPrivateDirectory = Readonly<{
  absolutePath: string;
  handle: FileHandle;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
}>;

export type PinnedPrivateFile = Readonly<{
  absolutePath: string;
  name: string;
  handle: FileHandle;
  dev: number;
  ino: number;
}>;

type OpenSnapshotFile = Readonly<{
  relativePath: string;
  absolutePath: string;
  handle: FileHandle;
  metadata: Stats;
  bytes: Uint8Array;
}>;

export async function validateRoot(
  root: string,
  privateRoot: boolean,
): Promise<string> {
  if (!isAbsolute(root) || resolve(root) !== root) {
    throw new TypeError("DFA-002 local roots must be normalized absolute paths.");
  }
  const metadata = await lstat(root);
  const expectedUid = currentUid();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (expectedUid !== undefined && metadata.uid !== expectedUid) ||
    (privateRoot
      ? (metadata.mode & 0o777) !== 0o700
      : (metadata.mode & 0o022) !== 0)
  ) {
    throw new Error("DFA-002 local root failed owner, mode, or type checks.");
  }
  return root;
}

export async function stableRead(
  root: string,
  relativePath: string,
  options: Readonly<{
    privateFile: boolean;
    maxBytes: number;
    hooks?: LocalDfa002ReadHooks;
  }>,
): Promise<Uint8Array> {
  const absolute = containedPath(root, relativePath);
  await inspectDirectoryChain(root, dirname(absolute), options.privateFile);
  const handle = await open(
    absolute,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    const pathBefore = await lstat(absolute);
    validateFileMetadata(before, pathBefore, options);
    const bytes = await handle.readFile();
    if (bytes.byteLength !== before.size) {
      throw new Error("DFA-002 file length changed while reading.");
    }
    await options.hooks?.afterRead?.(absolute);
    const after = await handle.stat();
    const pathAfter = await lstat(absolute);
    validateFileMetadata(after, pathAfter, options);
    if (!sameMetadata(before, after) || !sameMetadata(after, pathAfter)) {
      throw new Error("DFA-002 file inode changed while reading.");
    }
    await inspectDirectoryChain(root, dirname(absolute), options.privateFile);
    return copyBytes(bytes);
  } finally {
    await handle.close();
  }
}

export async function stableReadSet(
  root: string,
  relativePaths: readonly string[],
  options: Readonly<{
    privateFile: boolean;
    maxBytes: number;
    hooks?: LocalDfa002ReadHooks;
  }>,
): Promise<Map<string, Uint8Array>> {
  const paths = exactUniquePaths(relativePaths);
  const opened: OpenSnapshotFile[] = [];
  try {
    for (const relativePath of paths) {
      const absolutePath = containedPath(root, relativePath);
      await inspectDirectoryChain(root, dirname(absolutePath), options.privateFile);
      const handle = await open(
        absolutePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      try {
        const metadata = await handle.stat();
        const pathMetadata = await lstat(absolutePath);
        validateFileMetadata(metadata, pathMetadata, options);
        const bytes = await readExactHandleBytes(handle, metadata.size);
        await options.hooks?.afterRead?.(absolutePath);
        opened.push({
          relativePath,
          absolutePath,
          handle,
          metadata,
          bytes,
        });
      } catch (error) {
        await handle.close();
        throw error;
      }
    }
    const result = new Map<string, Uint8Array>();
    for (const file of opened) {
      const descriptorMetadata = await file.handle.stat();
      const pathMetadata = await lstat(file.absolutePath);
      validateFileMetadata(descriptorMetadata, pathMetadata, options);
      const reread = await readExactHandleBytes(
        file.handle,
        descriptorMetadata.size,
      );
      if (
        !sameMetadata(file.metadata, descriptorMetadata) ||
        !sameMetadata(descriptorMetadata, pathMetadata) ||
        !equalBytes(file.bytes, reread)
      ) {
        throw new Error("DFA-002 file set changed during coherent capture.");
      }
      await inspectDirectoryChain(
        root,
        dirname(file.absolutePath),
        options.privateFile,
      );
      result.set(file.relativePath, copyBytes(file.bytes));
    }
    return result;
  } finally {
    await Promise.all(opened.map(async (file) => await file.handle.close()));
  }
}

export async function readExactHandleBytes(
  handle: FileHandle,
  byteLength: number,
): Promise<Uint8Array> {
  const bytes = Buffer.alloc(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      byteLength - offset,
      offset,
    );
    if (bytesRead === 0) {
      throw new Error("DFA-002 file became shorter during capture.");
    }
    offset += bytesRead;
  }
  return bytes;
}

export function validateFileMetadata(
  descriptor: Stats,
  pathMetadata: Stats,
  options: Readonly<{ privateFile: boolean; maxBytes: number }>,
): void {
  const expectedUid = currentUid();
  if (
    !descriptor.isFile() ||
    !pathMetadata.isFile() ||
    pathMetadata.isSymbolicLink() ||
    descriptor.dev !== pathMetadata.dev ||
    descriptor.ino !== pathMetadata.ino ||
    descriptor.nlink !== 1 ||
    pathMetadata.nlink !== 1 ||
    descriptor.size < 1 ||
    descriptor.size > options.maxBytes ||
    (expectedUid !== undefined && descriptor.uid !== expectedUid) ||
    (options.privateFile
      ? (descriptor.mode & 0o777) !== 0o600
      : (descriptor.mode & 0o022) !== 0)
  ) {
    throw new Error("DFA-002 file failed descriptor safety checks.");
  }
}

export async function inspectDirectoryChain(
  root: string,
  target: string,
  privateChain: boolean,
): Promise<void> {
  await validateRoot(root, privateChain);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error("DFA-002 directory escaped its trusted root.");
  }
  let current = root;
  for (const component of relativeTarget.split(sep).filter(Boolean)) {
    current = join(current, component);
    const metadata = await lstat(current);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (currentUid() !== undefined && metadata.uid !== currentUid()) ||
      (privateChain
        ? (metadata.mode & 0o777) !== 0o700
        : (metadata.mode & 0o022) !== 0)
    ) {
      throw new Error("DFA-002 directory chain is unsafe.");
    }
  }
}

export function containedPath(root: string, relativePath: string): string {
  validateRelativePath(relativePath);
  const target = resolve(root, relativePath);
  const fromRoot = relative(root, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error("DFA-002 path escaped its injected root.");
  }
  return target;
}

export function exactUniquePaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  return paths.map((path) => {
    validateRelativePath(path);
    if (seen.has(path)) throw new TypeError("DFA-002 paths must be unique.");
    seen.add(path);
    return path;
  });
}

export function validateRelativePath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    !RELATIVE_PATH_PATTERN.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError("DFA-002 relative path is invalid.");
  }
}

export async function openPinnedPrivateDirectory(
  absolutePath: string,
): Promise<PinnedPrivateDirectory> {
  const handle = await open(
    absolutePath,
    fsConstants.O_RDONLY |
      fsConstants.O_DIRECTORY |
      fsConstants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    const pathMetadata = await lstat(absolutePath);
    if (
      !metadata.isDirectory() ||
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isDirectory() ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino ||
      (metadata.mode & 0o777) !== 0o700 ||
      (pathMetadata.mode & 0o777) !== 0o700 ||
      (currentUid() !== undefined && metadata.uid !== currentUid())
    ) {
      throw new Error("DFA-002 pinned private directory is unsafe.");
    }
    return {
      absolutePath,
      handle,
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      mode: metadata.mode,
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function verifyPinnedDirectory(
  directory: PinnedPrivateDirectory,
): Promise<void> {
  const descriptorMetadata = await directory.handle.stat();
  const pathMetadata = await lstat(directory.absolutePath);
  if (
    !descriptorMetadata.isDirectory() ||
    pathMetadata.isSymbolicLink() ||
    !pathMetadata.isDirectory() ||
    descriptorMetadata.dev !== directory.dev ||
    descriptorMetadata.ino !== directory.ino ||
    pathMetadata.dev !== directory.dev ||
    pathMetadata.ino !== directory.ino ||
    descriptorMetadata.uid !== directory.uid ||
    pathMetadata.uid !== directory.uid ||
    descriptorMetadata.mode !== directory.mode ||
    pathMetadata.mode !== directory.mode
  ) {
    throw new Error("DFA-002 pinned private directory changed.");
  }
}

export function pinnedChildPath(
  directory: PinnedPrivateDirectory,
  name: string,
): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw new TypeError("DFA-002 descriptor-relative filename is invalid.");
  }
  return join(directory.absolutePath, name);
}

export async function readInstalledPinnedFile(
  proposalDirectory: PinnedPrivateDirectory,
  destinationName: string,
  installedFile: PinnedPrivateFile,
  expectedBytes: Uint8Array,
): Promise<Uint8Array> {
  await verifyPinnedDirectory(proposalDirectory);
  const path = pinnedChildPath(proposalDirectory, destinationName);
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    const bytes = await readExactHandleBytes(handle, metadata.size);
    if (
      metadata.dev !== installedFile.dev ||
      metadata.ino !== installedFile.ino ||
      metadata.nlink !== 1 ||
      metadata.size !== expectedBytes.byteLength ||
      !equalBytes(bytes, expectedBytes)
    ) {
      throw new Error("DFA-002 proposal readback inode or bytes changed.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export function currentUid(): number | undefined {
  return process.geteuid?.() ?? process.getuid?.();
}

export function sameMetadata(
  left: Stats,
  right: Stats,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export async function ensurePrivateSubdirectory(
  root: string,
  name: string,
): Promise<string> {
  await validateRoot(root, true);
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw new TypeError("DFA-002 private directory name is invalid.");
  }
  const directory = join(root, name);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
  }
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (currentUid() !== undefined && metadata.uid !== currentUid())
  ) {
    throw new Error("DFA-002 private directory is unsafe.");
  }
  await syncDirectory(root);
  return directory;
}

export async function syncPinnedDirectory(
  directory: PinnedPrivateDirectory,
): Promise<void> {
  await directory.handle.sync();
}

export async function writePinnedPrivateFile(
  directory: PinnedPrivateDirectory,
  name: string,
  bytes: Uint8Array,
): Promise<PinnedPrivateFile> {
  await verifyPinnedDirectory(directory);
  const descriptorPath = pinnedChildPath(directory, name);
  const absolutePath = join(directory.absolutePath, name);
  const handle = await open(
    descriptorPath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
    0o600,
  );
  let metadata: Stats | undefined;
  try {
    metadata = await handle.stat();
    const createdPathMetadata = await lstat(descriptorPath);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size !== 0 ||
      metadata.dev !== createdPathMetadata.dev ||
      metadata.ino !== createdPathMetadata.ino
    ) {
      throw new Error("DFA-002 staged file creation was not exclusive.");
    }
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    metadata = await handle.stat();
    const descriptorMetadata = await lstat(descriptorPath);
    const pathMetadata = await lstat(absolutePath);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size !== bytes.byteLength ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.dev !== descriptorMetadata.dev ||
      metadata.ino !== descriptorMetadata.ino ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino ||
      (currentUid() !== undefined && metadata.uid !== currentUid())
    ) {
      throw new Error("DFA-002 staged proposal failed validation.");
    }
    await verifyPinnedDirectory(directory);
    return {
      absolutePath,
      name,
      handle,
      dev: metadata.dev,
      ino: metadata.ino,
    };
  } catch (error) {
    if (metadata !== undefined) {
      const current = await lstat(descriptorPath).catch(() => undefined);
      if (
        current !== undefined &&
        current.dev === metadata.dev &&
        current.ino === metadata.ino
      ) {
        await unlink(descriptorPath).catch(() => undefined);
        await syncPinnedDirectory(directory).catch(() => undefined);
      }
    }
    await handle.close();
    throw error;
  }
}

export async function verifyPinnedPrivateFile(
  directory: PinnedPrivateDirectory,
  file: PinnedPrivateFile,
  expectedBytes: Uint8Array,
  expectedLinkCount = 1,
): Promise<void> {
  await verifyPinnedDirectory(directory);
  const descriptorMetadata = await lstat(
    pinnedChildPath(directory, file.name),
  );
  const pathMetadata = await lstat(file.absolutePath);
  const handleMetadata = await file.handle.stat();
  const bytes = await readExactHandleBytes(file.handle, handleMetadata.size);
  if (
    handleMetadata.dev !== file.dev ||
    handleMetadata.ino !== file.ino ||
    handleMetadata.nlink !== expectedLinkCount ||
    descriptorMetadata.dev !== file.dev ||
    descriptorMetadata.ino !== file.ino ||
    pathMetadata.dev !== file.dev ||
    pathMetadata.ino !== file.ino ||
    (handleMetadata.mode & 0o777) !== 0o600 ||
    handleMetadata.size !== expectedBytes.byteLength ||
    !equalBytes(bytes, expectedBytes)
  ) {
    throw new Error("DFA-002 staged proposal inode or bytes changed.");
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === code,
  );
}

export const LOCAL_DFA002_DESCRIPTOR_HELPER_EXECUTABLE =
  "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python";
export const LOCAL_DFA002_DESCRIPTOR_HELPER_TIMEOUT_MS = 5_000;
export const LOCAL_DFA002_DESCRIPTOR_HELPER_MAX_BUFFER_BYTES = 4_096;

export type LocalDfa002DescriptorHelperRequest = Readonly<{
  executable: typeof LOCAL_DFA002_DESCRIPTOR_HELPER_EXECUTABLE;
  args: readonly string[];
  cwd: "/";
  env: Readonly<Record<string, string>>;
  descriptorFds: readonly number[];
  signal: AbortSignal;
  timeoutMs: number;
  maxBufferBytes: number;
  onStdout: (chunk: Uint8Array) => void;
  onStderr: (chunk: Uint8Array) => void;
}>;

export type LocalDfa002DescriptorHelperExit = Readonly<{
  exitCode: number | null;
  signal: string | null;
}>;

export type LocalDfa002DescriptorHelperRunner = (
  request: LocalDfa002DescriptorHelperRequest,
) => Promise<LocalDfa002DescriptorHelperExit>;

export class ProposalInstallReconciliationError extends AggregateError {}

export class DescriptorDestinationExistsError extends Error {}

export class DescriptorHelperTerminationUnprovenError extends Error {}

export class DescriptorUnlinkReconciliationError extends Error {}

export class DescriptorLinkReconciliationError extends Error {
  constructor(
    message: string,
    readonly helperTerminationProven = true,
  ) {
    super(message);
  }
}

export type DescriptorHelperResult = Readonly<{
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}>;

const DESCRIPTOR_LINK_SCRIPT = [
  "import os, sys",
  "source_name, destination_name = sys.argv[1], sys.argv[2]",
  "try:",
  "    staged = os.fstat(5)",
  "    source = os.stat(source_name, dir_fd=3, follow_symlinks=False)",
  "    if staged.st_dev != source.st_dev or staged.st_ino != source.st_ino or staged.st_nlink != 1:",
  "        sys.exit(72)",
  "except BaseException:",
  "    sys.exit(72)",
  "try:",
  "    os.link(source_name, destination_name, src_dir_fd=3, dst_dir_fd=4, follow_symlinks=False)",
  "except FileExistsError:",
  "    sys.exit(73)",
  "except BaseException:",
  "    sys.exit(74)",
  "try:",
  "    os.fsync(4)",
  "except BaseException:",
  "    sys.exit(79)",
  "sys.stdout.write('created\\n')",
].join("\n");

const DESCRIPTOR_VERIFY_LINK_SCRIPT = [
  "import os, sys",
  "destination_name = sys.argv[1]",
  "try:",
  "    staged = os.fstat(4)",
  "    installed = os.stat(destination_name, dir_fd=3, follow_symlinks=False)",
  "    if staged.st_dev != installed.st_dev or staged.st_ino != installed.st_ino or staged.st_nlink != 2:",
  "        sys.exit(75)",
  "except BaseException:",
  "    sys.exit(75)",
  "sys.stdout.write('verified\\n')",
].join("\n");

const DESCRIPTOR_UNLINK_SCRIPT = [
  "import os, sys",
  "name = sys.argv[1]",
  "try:",
  "    expected = os.fstat(4)",
  "    current = os.stat(name, dir_fd=3, follow_symlinks=False)",
  "except FileNotFoundError:",
  "    sys.exit(76)",
  "except BaseException:",
  "    sys.exit(78)",
  "if expected.st_dev != current.st_dev or expected.st_ino != current.st_ino:",
  "    sys.exit(77)",
  "try:",
  "    os.unlink(name, dir_fd=3)",
  "    os.fsync(3)",
  "except BaseException:",
  "    sys.exit(78)",
  "sys.stdout.write('unlinked\\n')",
].join("\n");

export type PublisherLock = Readonly<{
  absolutePath: string;
  name: string;
  handle: FileHandle;
  dev: number;
  ino: number;
  token: string;
}>;

export function validateDescriptorChildName(name: string): void {
  if (
    name === "." ||
    name === ".." ||
    !/^[A-Za-z0-9._-]{1,255}$/u.test(name)
  ) {
    throw new TypeError("DFA-002 descriptor-relative child name is invalid.");
  }
}

export async function runDescriptorHelper(
  runner: LocalDfa002DescriptorHelperRunner,
  script: string,
  args: readonly string[],
  descriptorFds: readonly number[],
): Promise<DescriptorHelperResult> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const abortController = new AbortController();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let pendingError: Error | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = () => {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
    };
    const finishUnproven = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      rejectPromise(
        new DescriptorHelperTerminationUnprovenError(
          "DFA-002 descriptor helper termination was not observed.",
        ),
      );
    };
    const requestTermination = (error: Error) => {
      if (settled || pendingError !== undefined) return;
      pendingError = error;
      abortController.abort();
      terminationTimer = setTimeout(finishUnproven, 1_000);
    };
    deadlineTimer = setTimeout(() => {
      requestTermination(new Error("DFA-002 descriptor helper timed out."));
    }, LOCAL_DFA002_DESCRIPTOR_HELPER_TIMEOUT_MS);
    const capture = (target: Buffer[]) => (chunk: Uint8Array) => {
      if (settled || pendingError !== undefined) return;
      if (!(chunk instanceof Uint8Array)) {
        requestTermination(
          new Error("DFA-002 descriptor helper output was malformed."),
        );
        return;
      }
      outputBytes += chunk.byteLength;
      if (outputBytes > LOCAL_DFA002_DESCRIPTOR_HELPER_MAX_BUFFER_BYTES) {
        requestTermination(
          new Error("DFA-002 descriptor helper output was oversized."),
        );
        return;
      }
      target.push(Buffer.from(chunk));
    };
    let completion: Promise<LocalDfa002DescriptorHelperExit>;
    try {
      completion = Promise.resolve(
        runner({
          executable: LOCAL_DFA002_DESCRIPTOR_HELPER_EXECUTABLE,
          args: ["-I", "-S", "-c", script, ...args],
          cwd: "/",
          env: Object.freeze({
            LANG: "C",
            LC_ALL: "C",
            NODE_ENV: "production",
            PYTHONDONTWRITEBYTECODE: "1",
            PYTHONHASHSEED: "0",
            PYTHONNOUSERSITE: "1",
          }),
          descriptorFds: [...descriptorFds],
          signal: abortController.signal,
          timeoutMs: LOCAL_DFA002_DESCRIPTOR_HELPER_TIMEOUT_MS,
          maxBufferBytes: LOCAL_DFA002_DESCRIPTOR_HELPER_MAX_BUFFER_BYTES,
          onStdout: capture(stdout),
          onStderr: capture(stderr),
        }),
      );
    } catch {
      finishUnproven();
      return;
    }
    completion.then((outcome) => {
      if (settled) return;
      if (!isDescriptorHelperExit(outcome)) {
        finishUnproven();
        return;
      }
      if (pendingError !== undefined) {
        if (outcome.exitCode !== null || outcome.signal !== "SIGKILL") {
          finishUnproven();
          return;
        }
        settled = true;
        clearTimers();
        rejectPromise(pendingError);
        return;
      }
      settled = true;
      clearTimers();
      if (outcome.signal !== null || outcome.exitCode === null) {
        rejectPromise(
          new Error("DFA-002 descriptor helper terminated abnormally."),
        );
        return;
      }
      resolvePromise({
        exitCode: outcome.exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    }, finishUnproven);
  });
}

export function isDescriptorHelperExit(
  value: unknown,
): value is LocalDfa002DescriptorHelperExit {
  if (value === null || typeof value !== "object") return false;
  const exit = value as Partial<LocalDfa002DescriptorHelperExit>;
  return (
    (Number.isInteger(exit.exitCode) &&
      (exit.exitCode as number) >= 0 &&
      exit.signal === null) ||
    (exit.exitCode === null &&
      typeof exit.signal === "string" &&
      /^SIG[A-Z0-9]+$/u.test(exit.signal))
  );
}

export async function runLocalDescriptorHelper(
  request: LocalDfa002DescriptorHelperRequest,
): Promise<LocalDfa002DescriptorHelperExit> {
  return await new Promise((resolvePromise) => {
    const child: ChildProcess = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      env: { NODE_ENV: "production", ...request.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe", ...request.descriptorFds],
      windowsHide: true,
    });
    const kill = () => child.kill("SIGKILL");
    if (request.signal.aborted) kill();
    else request.signal.addEventListener("abort", kill, { once: true });
    child.stdout!.on("data", request.onStdout);
    child.stderr!.on("data", request.onStderr);
    child.once("error", () => undefined);
    child.once("close", (exitCode, signal) => {
      request.signal.removeEventListener("abort", kill);
      resolvePromise({ exitCode, signal });
    });
  });
}

export async function descriptorRelativeLink(
  runner: LocalDfa002DescriptorHelperRunner,
  sourceDirectory: PinnedPrivateDirectory,
  sourceFile: PinnedPrivateFile,
  destinationDirectory: PinnedPrivateDirectory,
  destinationName: string,
): Promise<void> {
  validateDescriptorChildName(sourceFile.name);
  validateDescriptorChildName(destinationName);
  try {
    const result = await runDescriptorHelper(
      runner,
      DESCRIPTOR_LINK_SCRIPT,
      [sourceFile.name, destinationName],
      [
        sourceDirectory.handle.fd,
        destinationDirectory.handle.fd,
        sourceFile.handle.fd,
      ],
    );
    if (
      result.exitCode === 0 &&
      decodeUtf8(result.stdout) === "created\n" &&
      result.stderr.byteLength === 0
    ) {
      return;
    }
    if (result.exitCode === 73) {
      throw new DescriptorDestinationExistsError(
        "DFA-002 proposal destination already exists.",
      );
    }
    if (result.exitCode === 79 || result.exitCode === 74) {
      throw new DescriptorLinkReconciliationError(
        "DFA-002 descriptor-relative proposal link cleanup was not proven.",
      );
    }
    if (result.exitCode !== 72) {
      throw new DescriptorLinkReconciliationError(
        "DFA-002 descriptor-relative proposal link result was indeterminate.",
      );
    }
    throw new Error(
      `DFA-002 descriptor-relative proposal link failed with status ${result.exitCode}.`,
    );
  } catch (error) {
    if (
      error instanceof DescriptorDestinationExistsError ||
      error instanceof DescriptorLinkReconciliationError
    ) {
      throw error;
    }
    throw new DescriptorLinkReconciliationError(
      `DFA-002 descriptor-relative proposal link requires reconciliation: ${error instanceof Error ? error.message : "unknown helper failure"}`,
      !(error instanceof DescriptorHelperTerminationUnprovenError),
    );
  }
}

export async function descriptorRelativeVerifyLink(
  runner: LocalDfa002DescriptorHelperRunner,
  destinationDirectory: PinnedPrivateDirectory,
  destinationName: string,
  expectedFile: FileHandle,
): Promise<void> {
  validateDescriptorChildName(destinationName);
  const result = await runDescriptorHelper(
    runner,
    DESCRIPTOR_VERIFY_LINK_SCRIPT,
    [destinationName],
    [destinationDirectory.handle.fd, expectedFile.fd],
  );
  if (
    result.exitCode === 0 &&
    decodeUtf8(result.stdout) === "verified\n" &&
    result.stderr.byteLength === 0
  ) {
    return;
  }
  throw new Error("DFA-002 descriptor-relative proposal link was substituted.");
}

export type DescriptorUnlinkResult = "unlinked" | "missing" | "mismatch";

export async function descriptorRelativeUnlinkExact(
  runner: LocalDfa002DescriptorHelperRunner,
  directory: PinnedPrivateDirectory,
  name: string,
  expectedFile: FileHandle,
  afterUnlink?: () => Promise<void> | void,
): Promise<DescriptorUnlinkResult> {
  validateDescriptorChildName(name);
  const before = await expectedFile.stat();
  const result = await runDescriptorHelper(
    runner,
    DESCRIPTOR_UNLINK_SCRIPT,
    [name],
    [directory.handle.fd, expectedFile.fd],
  );
  if (
    result.exitCode === 0 &&
    decodeUtf8(result.stdout) === "unlinked\n" &&
    result.stderr.byteLength === 0
  ) {
    await afterUnlink?.();
    const after = await expectedFile.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.nlink < 1 ||
      after.nlink !== before.nlink - 1
    ) {
      throw new DescriptorUnlinkReconciliationError(
        "DFA-002 descriptor unlink did not prove the exact link-count decrement.",
      );
    }
    return "unlinked";
  }
  if (result.exitCode === 76) return "missing";
  if (result.exitCode === 77) return "mismatch";
  throw new Error("DFA-002 descriptor-relative unlink failed.");
}

export async function installPinnedPrivateFile(
  runner: LocalDfa002DescriptorHelperRunner,
  stagingDirectory: PinnedPrivateDirectory,
  stagedFile: PinnedPrivateFile,
  proposalDirectory: PinnedPrivateDirectory,
  destinationName: string,
  expectedBytes: Uint8Array,
  afterLink?: () => Promise<void> | void,
  afterSourceUnlink?: () => Promise<void> | void,
): Promise<void> {
  const destinationPath = pinnedChildPath(
    proposalDirectory,
    destinationName,
  );
  let linked = false;
  try {
    await descriptorRelativeLink(
      runner,
      stagingDirectory,
      stagedFile,
      proposalDirectory,
      destinationName,
    );
    linked = true;
    await afterLink?.();
    await descriptorRelativeVerifyLink(
      runner,
      proposalDirectory,
      destinationName,
      stagedFile.handle,
    );
    await verifyPinnedDirectory(stagingDirectory);
    await verifyPinnedDirectory(proposalDirectory);
    await verifyPinnedPrivateFile(
      stagingDirectory,
      stagedFile,
      expectedBytes,
      2,
    );
    const sourceRemoval = await descriptorRelativeUnlinkExact(
      runner,
      stagingDirectory,
      stagedFile.name,
      stagedFile.handle,
      afterSourceUnlink,
    );
    if (sourceRemoval !== "unlinked") {
      throw new Error("DFA-002 staged proposal could not be promoted.");
    }
    const installedMetadata = await stagedFile.handle.stat();
    const installedPathMetadata = await lstat(destinationPath);
    if (
      installedMetadata.dev !== stagedFile.dev ||
      installedMetadata.ino !== stagedFile.ino ||
      installedMetadata.nlink !== 1 ||
      installedPathMetadata.dev !== stagedFile.dev ||
      installedPathMetadata.ino !== stagedFile.ino
    ) {
      throw new Error("DFA-002 installed proposal did not settle immutably.");
    }
    await verifyPinnedDirectory(stagingDirectory);
    await verifyPinnedDirectory(proposalDirectory);
  } catch (error) {
    if (error instanceof DescriptorUnlinkReconciliationError) {
      throw new ProposalInstallReconciliationError(
        [error],
        "DFA-002 proposal install unlink requires manual reconciliation.",
      );
    }
    if (
      error instanceof DescriptorHelperTerminationUnprovenError ||
      (error instanceof DescriptorLinkReconciliationError &&
        !error.helperTerminationProven)
    ) {
      throw new ProposalInstallReconciliationError(
        [error],
        "DFA-002 proposal install helper requires manual reconciliation.",
      );
    }
    if (linked || error instanceof DescriptorLinkReconciliationError) {
      try {
        const rollback = await descriptorRelativeUnlinkExact(
          runner,
          proposalDirectory,
          destinationName,
          stagedFile.handle,
        );
        const remainingLinks = (await stagedFile.handle.stat()).nlink;
        if (
          remainingLinks > 1 ||
          (linked && rollback !== "unlinked" && rollback !== "missing") ||
          (error instanceof DescriptorLinkReconciliationError &&
            rollback === "mismatch")
        ) {
          throw new Error(
            "DFA-002 proposal rollback could not prove link removal.",
          );
        }
      } catch (rollbackError) {
        throw new ProposalInstallReconciliationError(
          [error, rollbackError],
          "DFA-002 proposal install failed and rollback requires reconciliation.",
        );
      }
    }
    throw error;
  }
}

export async function acquirePublisherLock(
  stagingDirectory: PinnedPrivateDirectory,
  name: string,
  absolutePath: string,
): Promise<PublisherLock> {
  const token = randomBytes(32).toString("hex");
  const descriptorPath = pinnedChildPath(stagingDirectory, name);
  let handle: FileHandle;
  try {
    handle = await open(
      descriptorPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR,
      0o600,
    );
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new Error(
        "DFA-002 proposal publication lock exists; manual reconciliation is required.",
      );
    }
    throw error;
  }
  let createdMetadata: Stats | undefined;
  try {
    createdMetadata = await handle.stat();
    await handle.writeFile(`${token}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    const metadata = await handle.stat();
    const descriptorMetadata = await lstat(descriptorPath);
    const pathMetadata = await lstat(absolutePath);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      descriptorMetadata.isSymbolicLink() ||
      pathMetadata.isSymbolicLink() ||
      metadata.dev !== descriptorMetadata.dev ||
      metadata.ino !== descriptorMetadata.ino ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino ||
      pathMetadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      (pathMetadata.mode & 0o777) !== 0o600 ||
      (currentUid() !== undefined && metadata.uid !== currentUid())
    ) {
      throw new Error("DFA-002 proposal publication lock is unsafe.");
    }
    await verifyPinnedDirectory(stagingDirectory);
    await syncPinnedDirectory(stagingDirectory);
    return {
      absolutePath,
      name,
      handle,
      dev: metadata.dev,
      ino: metadata.ino,
      token,
    };
  } catch (error) {
    if (createdMetadata !== undefined) {
      const pathMetadata = await lstat(descriptorPath).catch(() => undefined);
      if (
        pathMetadata !== undefined &&
        pathMetadata.dev === createdMetadata.dev &&
        pathMetadata.ino === createdMetadata.ino
      ) {
        await unlink(descriptorPath).catch(() => undefined);
        await syncPinnedDirectory(stagingDirectory).catch(() => undefined);
      }
    }
    await handle.close();
    throw error;
  }
}

export async function verifyPublisherLock(
  stagingDirectory: PinnedPrivateDirectory,
  lock: PublisherLock,
): Promise<void> {
  await verifyPinnedDirectory(stagingDirectory);
  const metadata = await lock.handle.stat();
  const descriptorMetadata = await lstat(
    pinnedChildPath(stagingDirectory, lock.name),
  );
  const pathMetadata = await lstat(lock.absolutePath);
  const bytes = await readExactHandleBytes(lock.handle, metadata.size);
  if (
    metadata.dev !== lock.dev ||
    metadata.ino !== lock.ino ||
    metadata.nlink !== 1 ||
    descriptorMetadata.dev !== lock.dev ||
    descriptorMetadata.ino !== lock.ino ||
    pathMetadata.dev !== lock.dev ||
    pathMetadata.ino !== lock.ino ||
    decodeUtf8(bytes) !== `${lock.token}\n`
  ) {
    throw new Error(
      "DFA-002 proposal publication lock changed; manual reconciliation is required.",
    );
  }
}

export async function releasePublisherLock(
  runner: LocalDfa002DescriptorHelperRunner,
  stagingDirectory: PinnedPrivateDirectory,
  lock: PublisherLock,
): Promise<void> {
  try {
    await verifyPublisherLock(stagingDirectory, lock);
    const result = await descriptorRelativeUnlinkExact(
      runner,
      stagingDirectory,
      lock.name,
      lock.handle,
    );
    if (result !== "unlinked") {
      throw new Error(
        "DFA-002 proposal publication lock cleanup requires manual reconciliation.",
      );
    }
  } finally {
    await lock.handle.close();
  }
}

export type PrivateArtifactStoreHooks = {
  beforePublish?: (temporaryPath: string) => Promise<void> | void;
};

export async function writePrivateEvaluationArtifact(input: {
  dataRoot: string;
  relativePath: string;
  contents: string | Uint8Array;
  expectedSha256?: string;
  hooks?: PrivateArtifactStoreHooks;
}): Promise<{
  relativePath: string;
  sha256: string;
  byteLength: number;
  mode: number;
}> {
  const { target, directories } = resolveEvaluationArtifactPath(
    input.dataRoot,
    input.relativePath
  );
  for (const directory of directories) {
    await ensurePrivateDirectory(directory);
  }
  const bytes =
    typeof input.contents === "string"
      ? Buffer.from(input.contents, "utf8")
      : Buffer.from(input.contents);
  const sha256 = rawSha256(bytes);
  if (input.expectedSha256 !== undefined && input.expectedSha256 !== sha256) {
    throw new TypeError("Private evaluation artifact content hash mismatch.");
  }
  const temporary = join(
    directories.at(-1)!,
    `.${target.slice(target.lastIndexOf(sep) + 1)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
  const storedRelativePath = relative(resolve(input.dataRoot), target);
  let handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null as never;
    await input.hooks?.beforePublish?.(temporary);
    const [readback, metadata] = await Promise.all([
      readFile(temporary),
      lstat(temporary)
    ]);
    if (
      !readback.equals(bytes) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size !== bytes.byteLength ||
      metadata.nlink !== 1
    ) {
      throw new TypeError("Private evaluation temporary artifact validation failed.");
    }
    // All fallible content and metadata validation happens before this atomic,
    // no-clobber commit point. After link succeeds, the final inode is complete.
    await link(temporary, target);
    return {
      relativePath: storedRelativePath,
      sha256,
      byteLength: bytes.byteLength,
      mode: metadata.mode & 0o777
    };
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

function resolveEvaluationArtifactPath(
  dataRoot: string,
  relativePath: string
): { target: string; directories: string[] } {
  if (!isAbsolute(dataRoot) || isAbsolute(relativePath)) {
    throw new TypeError("Evaluation artifact paths must use an absolute root and relative target.");
  }
  const parts = relativePath.split("/");
  if (
    parts.length < 4 ||
    parts[0] !== ".local" ||
    parts[1] !== "evaluations" ||
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        !/^[A-Za-z0-9._-]+$/u.test(part)
    ) ||
    !parts.at(-1)!.endsWith(".json")
  ) {
    throw new TypeError("Evaluation artifact target is outside the private evaluation store.");
  }
  const root = resolve(dataRoot);
  const target = resolve(root, ...parts);
  const relativeTarget = relative(root, target);
  if (relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
    throw new TypeError("Evaluation artifact target escapes its data root.");
  }
  const directories = parts.slice(0, -1).map((_, index) =>
    join(root, ...parts.slice(0, index + 1))
  );
  return { target, directories };
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !isOwnedByCurrentUser(metadata.uid)
  ) {
    throw new TypeError("Unsafe private evaluation directory.");
  }
  await chmod(directory, 0o700);
}

function isOwnedByCurrentUser(uid: number): boolean {
  const currentUid = process.getuid?.();
  return currentUid === undefined || uid === currentUid;
}

export type PrivateEvaluationArtifactSetFile = Readonly<{
  relativePath: string;
  mediaType: string;
  byteLength: number;
  rawSha256: string;
  bytes: Uint8Array;
}>;

export type VerifiedPrivateEvaluationArtifactSet = Readonly<{
  relativeDirectory: string;
  directoryMode: number;
  files: readonly Readonly<{
    relativePath: string;
    mediaType: string;
    byteLength: number;
    rawSha256: string;
    mode: number;
  }>[];
}>;

type PreparedPrivateEvaluationArtifactSetFile = Readonly<{
  relativePath: string;
  mediaType: string;
  byteLength: number;
  rawSha256: string;
  bytes: Uint8Array;
}>;

function validateArtifactSetPathComponents(
  pathComponents: readonly string[],
): readonly string[] {
  const isTask1PrivatePilotEpisodeClaimPath =
    pathComponents.length === 6 &&
    pathComponents[0] === ".local" &&
    pathComponents[1] === "dayflow-ablation" &&
    pathComponents[2] === "inputs" &&
    pathComponents[3] === "dayflow-ablation-private-pilot-v0.1" &&
    pathComponents[4] === "episode-claims" &&
    /^[a-f0-9]{64}$/u.test(pathComponents[5] ?? "");

  if (isTask1PrivatePilotEpisodeClaimPath) {
    return Object.freeze([...pathComponents]);
  }

  const isEvaluationArtifactPath =
    pathComponents.length >= 5 &&
    pathComponents[0] === ".local" &&
    pathComponents[1] === "evaluations";
  const isTask1EvaluationInputPath =
    pathComponents.length === 6 &&
    pathComponents[0] === ".local" &&
    pathComponents[1] === "dayflow-ablation" &&
    pathComponents[2] === "inputs" &&
    pathComponents[3] === "dayflow-ablation-private-pilot-v0.1" &&
    pathComponents[4] === "runs" &&
    /^[a-f0-9]{64}$/u.test(pathComponents[5] ?? "");
  const isTask1PrivatePilotAuthorizationPath =
    pathComponents.length === 6 &&
    pathComponents[0] === ".local" &&
    pathComponents[1] === "dayflow-ablation" &&
    pathComponents[2] === "inputs" &&
    pathComponents[3] === "dayflow-ablation-private-pilot-v0.1" &&
    pathComponents[4] === "authorizations" &&
    /^[a-f0-9]{64}$/u.test(pathComponents[5] ?? "");
  if (
    !isEvaluationArtifactPath &&
    !isTask1EvaluationInputPath &&
    !isTask1PrivatePilotAuthorizationPath
  ) {
    throw new TypeError(
      "Private artifact-set path must use an approved private artifact namespace.",
    );
  }
  return pathComponents.map((component) => {
    if (
      component.length === 0 ||
      component === "." ||
      component === ".." ||
      component.includes("/") ||
      component.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(component) ||
      !/^[A-Za-z0-9._-]+$/u.test(component)
    ) {
      throw new TypeError("Private artifact-set path component is unsafe.");
    }
    return component;
  });
}

function preparePrivateEvaluationArtifactSetFiles(
  files: readonly PrivateEvaluationArtifactSetFile[],
): readonly PreparedPrivateEvaluationArtifactSetFile[] {
  if (files.length < 1 || files.length > 32) {
    throw new TypeError("Private artifact set must contain between 1 and 32 files.");
  }
  const seen = new Set<string>();
  return files.map((file) => {
    if (
      file.relativePath.length === 0 ||
      file.relativePath === "." ||
      file.relativePath === ".." ||
      file.relativePath.includes("/") ||
      file.relativePath.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(file.relativePath) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(file.relativePath) ||
      seen.has(file.relativePath)
    ) {
      throw new TypeError("Private artifact-set filenames must be safe unique leaves.");
    }
    seen.add(file.relativePath);
    if (
      file.mediaType.length === 0 ||
      file.mediaType.length > 128 ||
      /[^\u0020-\u007e]/u.test(file.mediaType) ||
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 0 ||
      !/^[a-f0-9]{64}$/u.test(file.rawSha256) ||
      !(file.bytes instanceof Uint8Array)
    ) {
      throw new TypeError("Private artifact-set file metadata is invalid.");
    }
    const bytes = copyBytes(file.bytes);
    if (
      file.byteLength !== bytes.byteLength ||
      file.rawSha256 !== rawSha256(bytes)
    ) {
      throw new TypeError("Private artifact-set bytes do not match metadata.");
    }
    return {
      relativePath: file.relativePath,
      mediaType: file.mediaType,
      byteLength: bytes.byteLength,
      rawSha256: file.rawSha256,
      bytes,
    };
  });
}

async function openPrivateArtifactDirectoryChain(
  dataRoot: string,
  pathComponents: readonly string[],
): Promise<readonly PinnedPrivateDirectory[]> {
  await validateRoot(dataRoot, false);
  const directories: PinnedPrivateDirectory[] = [];
  let current = dataRoot;
  try {
    for (const component of pathComponents) {
      current = join(current, component);
      const directory = await openPinnedPrivateDirectory(current);
      directories.push(directory);
    }
    return directories;
  } catch (error) {
    await Promise.all(
      directories.map((directory) => directory.handle.close().catch(() => undefined)),
    );
    throw error;
  }
}

async function createUniquePrivateArtifactDirectoryChain(
  dataRoot: string,
  pathComponents: readonly string[],
): Promise<readonly PinnedPrivateDirectory[]> {
  await validateRoot(dataRoot, false);
  const directories: PinnedPrivateDirectory[] = [];
  let current = dataRoot;
  try {
    for (let index = 0; index < pathComponents.length - 1; index += 1) {
      const component = pathComponents[index]!;
      const child = join(current, component);
      try {
        await mkdir(child, { mode: 0o700 });
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
      }
      if (directories.length === 0) {
        await syncDirectory(dataRoot);
      } else {
        await verifyPinnedDirectory(directories.at(-1)!);
        await syncPinnedDirectory(directories.at(-1)!);
      }
      const directory = await openPinnedPrivateDirectory(child);
      directories.push(directory);
      current = child;
    }
    const parent = directories.at(-1);
    if (parent === undefined) {
      throw new TypeError("Private artifact-set parent directory is missing.");
    }
    await verifyPinnedDirectory(parent);
    const runDirectoryPath = pinnedChildPath(
      parent,
      pathComponents.at(-1)!,
    );
    await mkdir(runDirectoryPath, { mode: 0o700 });
    await syncPinnedDirectory(parent);
    const runDirectory = await openPinnedPrivateDirectory(runDirectoryPath);
    directories.push(runDirectory);
    await verifyPinnedDirectory(parent);
    return directories;
  } catch (error) {
    await Promise.all(
      directories.map((directory) => directory.handle.close().catch(() => undefined)),
    );
    throw error;
  }
}

async function writePrivateArtifactSetFileNoCleanup(
  directory: PinnedPrivateDirectory,
  file: PreparedPrivateEvaluationArtifactSetFile,
): Promise<PinnedPrivateFile> {
  await verifyPinnedDirectory(directory);
  const absolutePath = pinnedChildPath(directory, file.relativePath);
  const handle = await open(
    absolutePath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_RDWR |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    const initial = await handle.stat();
    const initialPath = await lstat(absolutePath);
    if (
      !initial.isFile() ||
      initial.nlink !== 1 ||
      initial.size !== 0 ||
      initial.dev !== initialPath.dev ||
      initial.ino !== initialPath.ino
    ) {
      throw new Error("Private artifact-set file creation was not exclusive.");
    }
    await handle.writeFile(file.bytes);
    await handle.chmod(0o600);
    await handle.sync();
    const metadata = await handle.stat();
    const pathMetadata = await lstat(absolutePath);
    if (
      !metadata.isFile() ||
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size !== file.byteLength ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.dev !== pathMetadata.dev ||
      metadata.ino !== pathMetadata.ino ||
      (currentUid() !== undefined && metadata.uid !== currentUid())
    ) {
      throw new Error("Private artifact-set file failed pinned validation.");
    }
    await verifyPinnedDirectory(directory);
    return {
      absolutePath,
      name: file.relativePath,
      handle,
      dev: metadata.dev,
      ino: metadata.ino,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function readPrivateArtifactSetFile(
  directory: PinnedPrivateDirectory,
  file: PreparedPrivateEvaluationArtifactSetFile,
): Promise<void> {
  await verifyPinnedDirectory(directory);
  const absolutePath = pinnedChildPath(directory, file.relativePath);
  const handle = await open(
    absolutePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    const beforePath = await lstat(absolutePath);
    const bytes = await readExactHandleBytes(handle, before.size);
    const after = await handle.stat();
    const afterPath = await lstat(absolutePath);
    if (
      !before.isFile() ||
      beforePath.isSymbolicLink() ||
      !beforePath.isFile() ||
      before.nlink !== 1 ||
      before.size !== file.byteLength ||
      (before.mode & 0o777) !== 0o600 ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.dev !== afterPath.dev ||
      before.ino !== afterPath.ino ||
      (currentUid() !== undefined && before.uid !== currentUid()) ||
      !equalBytes(bytes, file.bytes) ||
      rawSha256(bytes) !== file.rawSha256
    ) {
      throw new Error("Private artifact-set readback validation failed.");
    }
  } finally {
    await handle.close();
  }
  await verifyPinnedDirectory(directory);
}

export async function verifyPrivateEvaluationArtifactSetReadback(input: {
  dataRoot: string;
  pathComponents: readonly string[];
  expectedFiles: readonly PrivateEvaluationArtifactSetFile[];
}): Promise<VerifiedPrivateEvaluationArtifactSet> {
  const pathComponents = validateArtifactSetPathComponents(
    input.pathComponents,
  );
  const expectedFiles = preparePrivateEvaluationArtifactSetFiles(
    input.expectedFiles,
  );
  containedPath(input.dataRoot, pathComponents.join("/"));
  const directories = await openPrivateArtifactDirectoryChain(
    input.dataRoot,
    pathComponents,
  );
  const runDirectory = directories.at(-1)!;
  try {
    for (const file of expectedFiles) {
      await readPrivateArtifactSetFile(runDirectory, file);
    }
    await syncPinnedDirectory(runDirectory);
    return {
      relativeDirectory: pathComponents.join("/"),
      directoryMode: runDirectory.mode & 0o777,
      files: expectedFiles.map((file) => ({
        relativePath: file.relativePath,
        mediaType: file.mediaType,
        byteLength: file.byteLength,
        rawSha256: file.rawSha256,
        mode: 0o600,
      })),
    };
  } finally {
    await Promise.all(
      directories.map((directory) => directory.handle.close().catch(() => undefined)),
    );
  }
}

export async function publishPrivateEvaluationArtifactSetNoClobber(input: {
  dataRoot: string;
  pathComponents: readonly string[];
  files: readonly PrivateEvaluationArtifactSetFile[];
}): Promise<VerifiedPrivateEvaluationArtifactSet> {
  const pathComponents = validateArtifactSetPathComponents(
    input.pathComponents,
  );
  const files = preparePrivateEvaluationArtifactSetFiles(input.files);
  containedPath(input.dataRoot, pathComponents.join("/"));
  const directories = await createUniquePrivateArtifactDirectoryChain(
    input.dataRoot,
    pathComponents,
  );
  const runDirectory = directories.at(-1)!;
  const parentDirectory = directories.at(-2)!;
  const pinnedFiles: PinnedPrivateFile[] = [];
  try {
    for (const file of files) {
      const pinned = await writePrivateArtifactSetFileNoCleanup(
        runDirectory,
        file,
      );
      pinnedFiles.push(pinned);
      await verifyPinnedPrivateFile(runDirectory, pinned, file.bytes);
    }
    await syncPinnedDirectory(runDirectory);
    await syncPinnedDirectory(parentDirectory);
    for (let index = 0; index < files.length; index += 1) {
      await readInstalledPinnedFile(
        runDirectory,
        files[index]!.relativePath,
        pinnedFiles[index]!,
        files[index]!.bytes,
      );
    }
  } finally {
    await Promise.all(
      pinnedFiles.map((file) => file.handle.close().catch(() => undefined)),
    );
    await Promise.all(
      directories.map((directory) => directory.handle.close().catch(() => undefined)),
    );
  }
  return verifyPrivateEvaluationArtifactSetReadback({
    dataRoot: input.dataRoot,
    pathComponents,
    expectedFiles: files,
  });
}

export type PrivateEvaluationArtifactSetExactReadFileSpec = Readonly<{
  relativePath: string;
  mediaType: string;
  maxBytes: number;
}>;

export type PrivateEvaluationArtifactSetExactReadFile = Readonly<{
  relativePath: string;
  mediaType: string;
  byteLength: number;
  rawSha256: string;
  mode: number;
  bytes: Uint8Array;
}>;

export type ReadPrivateEvaluationArtifactSetExactResult = Readonly<{
  relativeDirectory: string;
  directoryMode: number;
  files: readonly PrivateEvaluationArtifactSetExactReadFile[];
  copyFiles: () => readonly PrivateEvaluationArtifactSetFile[];
}>;

export type PrivateEvaluationArtifactSetExactReadIssueCode =
  | "INPUT_INVALID"
  | "ENTRY_SET_MISMATCH"
  | "DIRECTORY_UNSAFE"
  | "FILE_UNSAFE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "FILE_UNSTABLE"
  | "FILESYSTEM_REJECTED";

export class PrivateEvaluationArtifactSetExactReadError extends Error {
  readonly issueCode: PrivateEvaluationArtifactSetExactReadIssueCode;

  constructor(issueCode: PrivateEvaluationArtifactSetExactReadIssueCode) {
    super(`Private evaluation artifact set exact read failed (${issueCode})`);
    this.name = "PrivateEvaluationArtifactSetExactReadError";
    this.issueCode = issueCode;
    Object.freeze(this);
  }
}

type PrivateEvaluationArtifactExactReadStat = Readonly<{
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

type PrivateEvaluationArtifactExactReadPin = Readonly<{
  absolutePath: string;
  handle: Awaited<ReturnType<typeof exactReadOpen>>;
  stat: PrivateEvaluationArtifactExactReadStat;
}>;

const PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_MAX_FILE_COUNT = 64;
const PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_MAX_TOTAL_BYTES = 5_242_880;
const PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_SAFE_COMPONENT =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function privateEvaluationArtifactExactReadStat(
  value: Readonly<{
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  }>,
): PrivateEvaluationArtifactExactReadStat {
  return Object.freeze({
    dev: value.dev,
    ino: value.ino,
    mode: value.mode,
    nlink: value.nlink,
    uid: value.uid,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs,
  });
}

function privateEvaluationArtifactExactReadSameStat(
  left: PrivateEvaluationArtifactExactReadStat,
  right: PrivateEvaluationArtifactExactReadStat,
): boolean {
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

function privateEvaluationArtifactExactReadFail(
  issueCode: PrivateEvaluationArtifactSetExactReadIssueCode,
): never {
  throw new PrivateEvaluationArtifactSetExactReadError(issueCode);
}

function privateEvaluationArtifactExactReadUid(): number {
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || (uid ?? -1) < 0) {
    return privateEvaluationArtifactExactReadFail("FILESYSTEM_REJECTED");
  }
  return uid as number;
}

function privateEvaluationArtifactExactReadDirectoryIsSafe(
  statValue: PrivateEvaluationArtifactExactReadStat,
  uid: number,
): boolean {
  return (
    (statValue.mode & exactReadFsConstants.S_IFMT) ===
      exactReadFsConstants.S_IFDIR &&
    (statValue.mode & 0o777) === 0o700 &&
    statValue.uid === uid
  );
}

function privateEvaluationArtifactExactReadRootDirectoryIsSafe(
  statValue: PrivateEvaluationArtifactExactReadStat,
  uid: number,
): boolean {
  return (
    (statValue.mode & exactReadFsConstants.S_IFMT) ===
      exactReadFsConstants.S_IFDIR &&
    (statValue.mode & 0o022) === 0 &&
    statValue.uid === uid
  );
}

function privateEvaluationArtifactExactReadFileIsSafe(
  statValue: PrivateEvaluationArtifactExactReadStat,
  uid: number,
): boolean {
  return (
    (statValue.mode & exactReadFsConstants.S_IFMT) ===
      exactReadFsConstants.S_IFREG &&
    (statValue.mode & 0o777) === 0o600 &&
    statValue.nlink === 1 &&
    statValue.uid === uid
  );
}

function privateEvaluationArtifactExactReadSnapshotInput(input: {
  dataRoot: string;
  pathComponents: readonly string[];
  fileSpecs: readonly PrivateEvaluationArtifactSetExactReadFileSpec[];
}): Readonly<{
  dataRoot: string;
  pathComponents: readonly string[];
  fileSpecs: readonly PrivateEvaluationArtifactSetExactReadFileSpec[];
}> {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.dataRoot !== "string" ||
      !exactReadIsAbsolute(input.dataRoot) ||
      input.dataRoot !== exactReadResolve(input.dataRoot) ||
      !Array.isArray(input.pathComponents) ||
      !Array.isArray(input.fileSpecs) ||
      input.fileSpecs.length === 0 ||
      input.fileSpecs.length >
        PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_MAX_FILE_COUNT
    ) {
      return privateEvaluationArtifactExactReadFail("INPUT_INVALID");
    }

    const pathComponents = validateArtifactSetPathComponents(
      input.pathComponents,
    );

    let totalMaxBytes = 0;
    const seen = new Set<string>();
    const fileSpecs = input.fileSpecs.map((spec) => {
      if (
        spec === null ||
        typeof spec !== "object" ||
        typeof spec.relativePath !== "string" ||
        !PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_SAFE_COMPONENT.test(
          spec.relativePath,
        ) ||
        seen.has(spec.relativePath) ||
        typeof spec.mediaType !== "string" ||
        spec.mediaType.length === 0 ||
        spec.mediaType.length > 128 ||
        !Number.isSafeInteger(spec.maxBytes) ||
        spec.maxBytes < 0 ||
        spec.maxBytes >
          PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_MAX_TOTAL_BYTES
      ) {
        return privateEvaluationArtifactExactReadFail("INPUT_INVALID");
      }
      seen.add(spec.relativePath);
      totalMaxBytes += spec.maxBytes;
      if (
        !Number.isSafeInteger(totalMaxBytes) ||
        totalMaxBytes >
          PRIVATE_EVALUATION_ARTIFACT_EXACT_READ_MAX_TOTAL_BYTES
      ) {
        return privateEvaluationArtifactExactReadFail(
          "RESOURCE_LIMIT_EXCEEDED",
        );
      }
      return Object.freeze({
        relativePath: spec.relativePath,
        mediaType: spec.mediaType,
        maxBytes: spec.maxBytes,
      });
    });

    return Object.freeze({
      dataRoot: input.dataRoot,
      pathComponents: Object.freeze(pathComponents),
      fileSpecs: Object.freeze(fileSpecs),
    });
  } catch (error) {
    if (error instanceof PrivateEvaluationArtifactSetExactReadError) {
      throw error;
    }
    return privateEvaluationArtifactExactReadFail("INPUT_INVALID");
  }
}

async function privateEvaluationArtifactExactReadOpenDirectory(
  absolutePath: string,
  uid: number,
  policy: "trusted-root" | "private",
): Promise<PrivateEvaluationArtifactExactReadPin> {
  const isSafe =
    policy === "trusted-root"
      ? privateEvaluationArtifactExactReadRootDirectoryIsSafe
      : privateEvaluationArtifactExactReadDirectoryIsSafe;
  const pathStat = privateEvaluationArtifactExactReadStat(
    await exactReadLstat(absolutePath),
  );
  if (!isSafe(pathStat, uid)) {
    return privateEvaluationArtifactExactReadFail("DIRECTORY_UNSAFE");
  }

  const handle = await exactReadOpen(
    absolutePath,
    exactReadFsConstants.O_RDONLY |
      exactReadFsConstants.O_DIRECTORY |
      exactReadFsConstants.O_NOFOLLOW,
  );
  try {
    const handleStat = privateEvaluationArtifactExactReadStat(
      await handle.stat(),
    );
    if (
      !isSafe(handleStat, uid) ||
      !privateEvaluationArtifactExactReadSameStat(pathStat, handleStat)
    ) {
      return privateEvaluationArtifactExactReadFail("DIRECTORY_UNSAFE");
    }
    return Object.freeze({ absolutePath, handle, stat: handleStat });
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function privateEvaluationArtifactExactReadAssertEntrySet(
  actual: readonly string[],
  expected: readonly string[],
): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    privateEvaluationArtifactExactReadFail("ENTRY_SET_MISMATCH");
  }
}

export async function readPrivateEvaluationArtifactSetExact(input: {
  dataRoot: string;
  pathComponents: readonly string[];
  fileSpecs: readonly PrivateEvaluationArtifactSetExactReadFileSpec[];
}): Promise<ReadPrivateEvaluationArtifactSetExactResult> {
  const snapshot = privateEvaluationArtifactExactReadSnapshotInput(input);
  const uid = privateEvaluationArtifactExactReadUid();
  const pins: PrivateEvaluationArtifactExactReadPin[] = [];

  try {
    const canonicalRoot = await exactReadRealpath(snapshot.dataRoot);
    const relativeRoot = exactReadRelative(snapshot.dataRoot, canonicalRoot);
    if (
      relativeRoot !== "" &&
      (relativeRoot === ".." ||
        relativeRoot.startsWith(`..${exactReadSeparator}`) ||
        exactReadIsAbsolute(relativeRoot))
    ) {
      return privateEvaluationArtifactExactReadFail("DIRECTORY_UNSAFE");
    }

    let directory = canonicalRoot;
    pins.push(
      await privateEvaluationArtifactExactReadOpenDirectory(
        directory,
        uid,
        "trusted-root",
      ),
    );
    for (const component of snapshot.pathComponents) {
      directory = exactReadJoin(directory, component);
      const relativeDirectory = exactReadRelative(canonicalRoot, directory);
      if (
        relativeDirectory === ".." ||
        relativeDirectory.startsWith(`..${exactReadSeparator}`) ||
        exactReadIsAbsolute(relativeDirectory)
      ) {
        return privateEvaluationArtifactExactReadFail("DIRECTORY_UNSAFE");
      }
      pins.push(
        await privateEvaluationArtifactExactReadOpenDirectory(
          directory,
          uid,
          "private",
        ),
      );
    }

    const expectedNames = snapshot.fileSpecs.map(
      (spec) => spec.relativePath,
    );
    const initialEntries = await exactReadDirectoryEntries(directory);
    privateEvaluationArtifactExactReadAssertEntrySet(
      initialEntries,
      expectedNames,
    );

    const retained: Array<
      Readonly<{
        relativePath: string;
        mediaType: string;
        byteLength: number;
        rawSha256: string;
        mode: number;
        bytes: Uint8Array;
      }>
    > = [];

    for (const spec of snapshot.fileSpecs) {
      const absolutePath = exactReadJoin(directory, spec.relativePath);
      const pathBefore = privateEvaluationArtifactExactReadStat(
        await exactReadLstat(absolutePath),
      );
      if (!privateEvaluationArtifactExactReadFileIsSafe(pathBefore, uid)) {
        return privateEvaluationArtifactExactReadFail("FILE_UNSAFE");
      }
      if (pathBefore.size > spec.maxBytes) {
        return privateEvaluationArtifactExactReadFail(
          "RESOURCE_LIMIT_EXCEEDED",
        );
      }

      const handle = await exactReadOpen(
        absolutePath,
        exactReadFsConstants.O_RDONLY | exactReadFsConstants.O_NOFOLLOW,
      );
      try {
        const before = privateEvaluationArtifactExactReadStat(
          await handle.stat(),
        );
        if (
          !privateEvaluationArtifactExactReadFileIsSafe(before, uid) ||
          !privateEvaluationArtifactExactReadSameStat(pathBefore, before)
        ) {
          return privateEvaluationArtifactExactReadFail("FILE_UNSAFE");
        }
        if (before.size > spec.maxBytes) {
          return privateEvaluationArtifactExactReadFail(
            "RESOURCE_LIMIT_EXCEEDED",
          );
        }

        const buffer = await handle.readFile();
        const after = privateEvaluationArtifactExactReadStat(
          await handle.stat(),
        );
        const pathAfter = privateEvaluationArtifactExactReadStat(
          await exactReadLstat(absolutePath),
        );
        if (
          buffer.byteLength !== before.size ||
          !privateEvaluationArtifactExactReadSameStat(before, after) ||
          !privateEvaluationArtifactExactReadSameStat(after, pathAfter)
        ) {
          return privateEvaluationArtifactExactReadFail("FILE_UNSTABLE");
        }

        const bytes = new Uint8Array(buffer);
        retained.push(
          Object.freeze({
            relativePath: spec.relativePath,
            mediaType: spec.mediaType,
            byteLength: bytes.byteLength,
            rawSha256: rawSha256(bytes),
            mode: after.mode & 0o777,
            bytes,
          }),
        );
      } finally {
        await handle.close().catch(() => undefined);
      }
    }

    const finalEntries = await exactReadDirectoryEntries(directory);
    privateEvaluationArtifactExactReadAssertEntrySet(
      finalEntries,
      expectedNames,
    );

    for (const pin of pins) {
      const handleAfter = privateEvaluationArtifactExactReadStat(
        await pin.handle.stat(),
      );
      const pathAfter = privateEvaluationArtifactExactReadStat(
        await exactReadLstat(pin.absolutePath),
      );
      if (
        !privateEvaluationArtifactExactReadSameStat(pin.stat, handleAfter) ||
        !privateEvaluationArtifactExactReadSameStat(handleAfter, pathAfter)
      ) {
        return privateEvaluationArtifactExactReadFail("FILE_UNSTABLE");
      }
    }

    const publicFiles = Object.freeze(
      retained.map((file) =>
        Object.freeze({
          relativePath: file.relativePath,
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          rawSha256: file.rawSha256,
          mode: file.mode,
          bytes: new Uint8Array(file.bytes),
        }),
      ),
    );
    const copyFiles = (): readonly PrivateEvaluationArtifactSetFile[] =>
      Object.freeze(
        retained.map((file) =>
          Object.freeze({
            relativePath: file.relativePath,
            mediaType: file.mediaType,
            byteLength: file.byteLength,
            rawSha256: file.rawSha256,
            bytes: new Uint8Array(file.bytes),
          }),
        ),
      );

    return Object.freeze({
      relativeDirectory: snapshot.pathComponents.join("/"),
      directoryMode: pins[pins.length - 1]!.stat.mode & 0o777,
      files: publicFiles,
      copyFiles,
    });
  } catch (error) {
    if (error instanceof PrivateEvaluationArtifactSetExactReadError) {
      throw error;
    }
    return privateEvaluationArtifactExactReadFail("FILESYSTEM_REJECTED");
  } finally {
    await Promise.all(
      pins.map((pin) => pin.handle.close().catch(() => undefined)),
    );
  }
}
