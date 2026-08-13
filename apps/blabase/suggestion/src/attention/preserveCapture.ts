import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  type Stats
} from "node:fs";
import {
  lstat,
  open,
  readdir
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const PRESERVE_CAPTURE_CONTRACT =
  "attention-preserve-capture-v0.1" as const;

export type PreserveCaptureScope = "base" | "semantic";

export type PreserveCaptureErrorCode =
  | "PRESERVE_CAPTURE_INVALID"
  | "PRESERVE_CAPTURE_UNSTABLE"
  | "PRESERVE_CAPTURE_READ_FAILED";

export class PreserveCaptureError extends Error {
  constructor(public readonly code: PreserveCaptureErrorCode) {
    super(code);
    this.name = "PreserveCaptureError";
  }
}

export function isPreserveCaptureError(
  error: unknown
): error is PreserveCaptureError {
  return error instanceof PreserveCaptureError;
}

export type PreserveCaptureManifestEntry = {
  path: string;
  type: "directory" | "file";
  mode: number;
  uid: number;
  gid: number;
  device: number;
  inode: number;
  linkCount: number;
  size: number;
  modifiedAtMs: number;
  changedAtMs: number;
  sha256: string;
};

export type PreserveCaptureManifest = {
  contract: typeof PRESERVE_CAPTURE_CONTRACT;
  scope: PreserveCaptureScope;
  entries: PreserveCaptureManifestEntry[];
  manifestSha256: string;
};

export async function capturePreservingLocalState<T>(input: {
  cwd?: string;
  scope?: PreserveCaptureScope;
  read: () => Promise<T>;
  maxAttempts?: 1 | 2;
}): Promise<T> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const scope = input.scope ?? "base";
  const maxAttempts = input.maxAttempts ?? 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const before = await buildPreserveCaptureManifest(cwd, scope);
      const value = await input.read();
      const after = await buildPreserveCaptureManifest(cwd, scope);
      if (sameManifest(before, after)) return value;
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    } catch (error) {
      if (
        !(error instanceof PreserveCaptureError) ||
        error.code !== "PRESERVE_CAPTURE_UNSTABLE" ||
        attempt === maxAttempts
      ) {
        throw error;
      }
    }
  }
  throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
}

export async function buildPreserveCaptureManifest(
  cwdInput: string,
  scope: PreserveCaptureScope = "base"
): Promise<PreserveCaptureManifest> {
  const cwd = resolve(cwdInput);
  const expectedUid = process.geteuid?.() ?? process.getuid?.();
  const entries: PreserveCaptureManifestEntry[] = [];
  await inspectTrustedAncestors(cwd, expectedUid, scope, entries);
  for (const relativeRoot of rootsForScope(scope)) {
    const absoluteRoot = resolve(cwd, relativeRoot);
    assertInsideRoot(cwd, absoluteRoot);
    const root = await lstatIfPresent(absoluteRoot);
    if (root === null) continue;
    await visit({
      cwd,
      absolutePath: absoluteRoot,
      metadata: root,
      expectedUid,
      scope,
      entries
    });
  }
  entries.sort((left, right) => compareCodeUnits(left.path, right.path));
  const content = {
    contract: PRESERVE_CAPTURE_CONTRACT,
    scope,
    entries
  };
  return {
    ...content,
    manifestSha256: createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex")
  };
}

function rootsForScope(scope: PreserveCaptureScope): readonly string[] {
  return scope === "base"
    ? [
        join(".local", "connectors"),
        join(".local", "context"),
        join(".local", "work-resumption")
      ]
    : [join(".local", "semantic-continuation")];
}

async function visit(input: {
  cwd: string;
  absolutePath: string;
  metadata: Stats;
  expectedUid: number | undefined;
  scope: PreserveCaptureScope;
  entries: PreserveCaptureManifestEntry[];
}): Promise<void> {
  const relativePath = normalizedRelativePath(input.cwd, input.absolutePath);
  if (input.metadata.isSymbolicLink()) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
  }
  if (
    input.expectedUid !== undefined &&
    input.metadata.uid !== input.expectedUid
  ) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
  }

  if (input.metadata.isDirectory()) {
    if ((input.metadata.mode & 0o777) !== 0o700) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
    }
    const directoryRead = await readStableDirectory(
      input.absolutePath,
      input.metadata,
      input.expectedUid,
      true
    );
    input.entries.push(
      manifestEntry(
        relativePath,
        "directory",
        directoryRead.metadata,
        hashDirectoryListing(directoryRead.names)
      )
    );
    const names = directoryRead.names;
    for (const name of names) {
      if (isCriticalSentinel(relativePath, name, input.scope)) {
        throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
      }
      const child = join(input.absolutePath, name);
      const childMetadata = await lstatPresent(child);
      await visit({ ...input, absolutePath: child, metadata: childMetadata });
    }
    return;
  }

  if (!input.metadata.isFile() || (input.metadata.mode & 0o777) !== 0o600) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
  }
  const read = await readStablePrivateFile(
    input.absolutePath,
    input.metadata,
    input.expectedUid
  );
  input.entries.push({
    ...manifestEntry(relativePath, "file", read.metadata, read.sha256),
    sha256: read.sha256
  });
}

function manifestEntry(
  path: string,
  type: "directory" | "file",
  metadata: Stats,
  sha256: string
): PreserveCaptureManifestEntry {
  return {
    path,
    type,
    mode: metadata.mode & 0o777,
    uid: metadata.uid,
    gid: metadata.gid,
    device: metadata.dev,
    inode: metadata.ino,
    linkCount: metadata.nlink,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    changedAtMs: metadata.ctimeMs,
    sha256
  };
}

async function readStablePrivateFile(
  path: string,
  expected: Stats,
  expectedUid: number | undefined
): Promise<{ metadata: Stats; sha256: string }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const before = await handle.stat();
    assertPrivateFile(before, expectedUid);
    if (!sameFingerprint(expected, before)) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assertPrivateFile(after, expectedUid);
    if (!sameFingerprint(before, after)) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    const pathAfter = await lstatPresent(path);
    assertPrivateFile(pathAfter, expectedUid);
    if (!sameFingerprint(after, pathAfter)) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    return {
      metadata: after,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } catch (error) {
    if (error instanceof PreserveCaptureError) throw error;
    if (
      isNodeError(error, "ELOOP") ||
      isNodeError(error, "ENOENT") ||
      isNodeError(error, "ENOTDIR")
    ) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    throw new PreserveCaptureError("PRESERVE_CAPTURE_READ_FAILED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readStableDirectory(
  path: string,
  expected: Stats,
  expectedUid: number | undefined,
  requirePrivate: boolean
): Promise<{ metadata: Stats; names: string[] }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const before = await handle.stat();
    assertTrustedDirectory(before, expectedUid, requirePrivate);
    if (!sameFingerprint(expected, before)) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    const names = await readSortedDirectory(path);
    const after = await handle.stat();
    assertTrustedDirectory(after, expectedUid, requirePrivate);
    const pathAfter = await lstatPresent(path);
    assertTrustedDirectory(pathAfter, expectedUid, requirePrivate);
    if (
      !sameFingerprint(before, after) ||
      !sameFingerprint(after, pathAfter)
    ) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    return { metadata: after, names };
  } catch (error) {
    if (error instanceof PreserveCaptureError) throw error;
    if (
      isNodeError(error, "ELOOP") ||
      isNodeError(error, "ENOENT") ||
      isNodeError(error, "ENOTDIR")
    ) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    throw new PreserveCaptureError("PRESERVE_CAPTURE_READ_FAILED");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function assertPrivateFile(
  metadata: Stats,
  expectedUid: number | undefined
): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (expectedUid !== undefined && metadata.uid !== expectedUid)
  ) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
  }
}

function sameFingerprint(left: Stats, right: Stats): boolean {
  return (
    left.isFile() === right.isFile() &&
    left.isDirectory() === right.isDirectory() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sameManifest(
  left: PreserveCaptureManifest,
  right: PreserveCaptureManifest
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCriticalSentinel(
  parentPath: string,
  name: string,
  scope: PreserveCaptureScope
): boolean {
  if (isRecognizedTemp(name)) return true;
  const normalized = `${parentPath}/${name}`;
  if (scope === "base") {
    return (
      (parentPath.endsWith("/locks") && name.endsWith(".lock")) ||
      normalized.endsWith("/connectors/codex/managed/settlement.json")
    );
  }
  return normalized.endsWith("/semantic-continuation/validation/run.lock");
}

function isRecognizedTemp(name: string): boolean {
  return (
    /\.tmp$/u.test(name) ||
    /\.partial$/u.test(name) ||
    /\.settlement$/u.test(name)
  );
}

async function readSortedDirectory(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort(compareCodeUnits);
  } catch (error) {
    if (
      isNodeError(error, "ENOENT") ||
      isNodeError(error, "ENOTDIR")
    ) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
    }
    throw new PreserveCaptureError("PRESERVE_CAPTURE_READ_FAILED");
  }
}

async function lstatIfPresent(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    if (isNodeError(error, "ENOTDIR")) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
    }
    throw new PreserveCaptureError("PRESERVE_CAPTURE_READ_FAILED");
  }
}

async function lstatPresent(path: string): Promise<Stats> {
  const metadata = await lstatIfPresent(path);
  if (metadata === null) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE");
  }
  return metadata;
}

function normalizedRelativePath(cwd: string, path: string): string {
  assertInsideRoot(cwd, path);
  return relative(cwd, path).split(sep).join("/");
}

async function inspectTrustedAncestors(
  cwd: string,
  expectedUid: number | undefined,
  scope: PreserveCaptureScope,
  entries: PreserveCaptureManifestEntry[]
): Promise<void> {
  const cwdMetadata = await lstatPresent(cwd);
  const cwdRead = await readStableDirectory(
    cwd,
    cwdMetadata,
    expectedUid,
    false
  );
  const localPath = join(cwd, ".local");
  let localMetadata: Stats | null;
  try {
    localMetadata = await lstat(localPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      entries.push(sharedAncestorEntry(".", cwdRead.metadata, []));
      return;
    }
    if (isNodeError(error, "ENOTDIR")) {
      throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
    }
    throw new PreserveCaptureError("PRESERVE_CAPTURE_READ_FAILED");
  }
  const localRead = await readStableDirectory(
    localPath,
    localMetadata,
    expectedUid,
    true
  );
  const scopedNames = localRead.names.filter((name) =>
    localRootNamesForScope(scope).includes(name)
  );
  entries.push(
    sharedAncestorEntry(
      ".",
      cwdRead.metadata,
      scopedNames.length > 0 ? [".local"] : []
    )
  );
  if (scopedNames.length === 0) return;
  entries.push(
    sharedAncestorEntry(
      ".local",
      localRead.metadata,
      scopedNames
    )
  );
}

function assertTrustedDirectory(
  metadata: Stats,
  expectedUid: number | undefined,
  requirePrivate: boolean
): void {
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (expectedUid !== undefined && metadata.uid !== expectedUid) ||
    (requirePrivate && (metadata.mode & 0o777) !== 0o700)
  ) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashDirectoryListing(names: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(names)).digest("hex");
}

function sharedAncestorEntry(
  path: string,
  metadata: Stats,
  scopedNames: readonly string[]
): PreserveCaptureManifestEntry {
  const entry = manifestEntry(
    path,
    "directory",
    metadata,
    hashDirectoryListing(scopedNames)
  );
  return {
    ...entry,
    linkCount: 0,
    size: 0,
    modifiedAtMs: 0,
    changedAtMs: 0
  };
}

function localRootNamesForScope(
  scope: PreserveCaptureScope
): readonly string[] {
  return scope === "base"
    ? ["connectors", "context", "work-resumption"]
    : ["semantic-continuation"];
}


function assertInsideRoot(cwd: string, path: string): void {
  const relativePath = relative(cwd, path);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new PreserveCaptureError("PRESERVE_CAPTURE_INVALID");
  }
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
