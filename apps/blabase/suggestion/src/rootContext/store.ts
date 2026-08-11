import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile
} from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join } from "node:path";

import { runtimeStatusResponse } from "../sync/runtime";
import { sourceSyncLatestStoreSchema } from "../sync/schema";
import {
  ROOT_CONTEXT_CONTRACT,
  ROOT_MARKER_CONTRACT,
  rootContextSchema,
  rootMarkerSchema,
  rootSyncRevisionSchema,
  type RootContext,
  type RootMarker
} from "./contracts";

const ROOT_MARKER_FILENAME = "root-context.json";
const MAX_ROOT_MARKER_BYTES = 4 * 1024;
const MAX_SYNC_LATEST_BYTES = 2 * 1024 * 1024;

type RootMarkerReadResult =
  | { status: "ready"; marker: RootMarker }
  | { status: "missing" }
  | { status: "invalid" };

export type RootMarkerAccess = "owner" | "read_only";

export class RootContextStoreError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ROOT"
      | "ROOT_MARKER_INVALID"
      | "ROOT_MARKER_WRITE_FAILED"
  ) {
    super(code);
    this.name = "RootContextStoreError";
  }
}

export function rootMarkerPath(dataRoot: string): string {
  assertAbsoluteRoot(dataRoot);
  return join(dataRoot, ".local", ROOT_MARKER_FILENAME);
}

/**
 * Resolves the opaque identity for one data root. Owners publish a missing
 * marker; read-only consumers never repair permissions or create files.
 */
export async function resolveRootMarker(
  dataRoot: string,
  access: RootMarkerAccess
): Promise<RootMarker | null> {
  assertAbsoluteRoot(dataRoot);
  if (access === "owner") {
    await prepareOwnedMarkerStorage(dataRoot);
  }
  const current = await inspectRootMarker(dataRoot);
  if (current.status === "ready") {
    return current.marker;
  }
  if (access === "read_only") return null;
  if (current.status === "invalid") {
    throw new RootContextStoreError("ROOT_MARKER_INVALID");
  }
  return createRootMarker(dataRoot);
}

export async function readRootMarker(
  dataRoot: string
): Promise<RootMarker | null> {
  assertAbsoluteRoot(dataRoot);
  const result = await inspectRootMarker(dataRoot);
  return result.status === "ready" ? result.marker : null;
}

export async function readPersistedSyncRevision(
  dataRoot: string
): Promise<string | null> {
  assertAbsoluteRoot(dataRoot);
  const target = join(dataRoot, ".local", "sync", "latest.json");
  const text = await readPrivateBoundedFile(
    target,
    MAX_SYNC_LATEST_BYTES
  );
  if (text === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = sourceSyncLatestStoreSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    !Object.values(parsed.data.sources).some(
      (source) => source.latestSnapshot !== null
    )
  ) {
    return null;
  }

  const revision = runtimeStatusResponse(parsed.data).revision;
  const bounded = rootSyncRevisionSchema.safeParse(revision);
  return bounded.success ? bounded.data : null;
}

export async function resolveDashboardRootContext(
  dataRoot: string = process.cwd()
): Promise<RootContext> {
  const marker = await resolveRootMarker(dataRoot, "owner");
  if (!marker) {
    throw new RootContextStoreError("ROOT_MARKER_WRITE_FAILED");
  }
  return rootContextSchema.parse({
    contract: ROOT_CONTEXT_CONTRACT,
    rootId: marker.rootId,
    mutationAuthority: "dashboard",
    syncRevision: await readPersistedSyncRevision(dataRoot)
  });
}

async function createRootMarker(dataRoot: string): Promise<RootMarker> {
  await ensurePrivateLocalDirectory(dataRoot);
  const target = rootMarkerPath(dataRoot);
  const marker = rootMarkerSchema.parse({
    contract: ROOT_MARKER_CONTRACT,
    rootId: `root_${randomBytes(16).toString("hex")}`
  });
  const serialized = `${JSON.stringify(marker, null, 2)}\n`;
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString(
    "hex"
  )}.tmp`;

  try {
    await writeFile(temporary, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await chmod(temporary, 0o600);
    // The hard-link publication is an atomic, non-overwriting commit point.
    // Concurrent owners therefore converge on the first complete marker.
    await link(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (isNodeError(error, "EEXIST")) {
      const winner = await inspectRootMarker(dataRoot);
      if (winner.status === "ready") return winner.marker;
      throw new RootContextStoreError("ROOT_MARKER_INVALID");
    }
    throw new RootContextStoreError("ROOT_MARKER_WRITE_FAILED");
  }

  await unlink(temporary).catch(() => undefined);
  const committed = await inspectRootMarker(dataRoot);
  if (
    committed.status !== "ready" ||
    committed.marker.rootId !== marker.rootId
  ) {
    throw new RootContextStoreError("ROOT_MARKER_WRITE_FAILED");
  }
  return committed.marker;
}

async function inspectRootMarker(
  dataRoot: string
): Promise<RootMarkerReadResult> {
  const localDirectory = join(dataRoot, ".local");
  const directoryMetadata = await safeLstat(localDirectory);
  if (directoryMetadata === null) return { status: "missing" };
  if (
    !directoryMetadata.isDirectory() ||
    directoryMetadata.isSymbolicLink() ||
    !isOwnedByCurrentUser(directoryMetadata.uid) ||
    (directoryMetadata.mode & 0o777) !== 0o700
  ) {
    return { status: "invalid" };
  }

  const target = rootMarkerPath(dataRoot);
  const text = await readPrivateBoundedFile(
    target,
    MAX_ROOT_MARKER_BYTES
  );
  if (text === null) {
    const metadata = await safeLstat(target);
    return metadata === null
      ? { status: "missing" }
      : { status: "invalid" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid" };
  }
  const parsed = rootMarkerSchema.safeParse(value);
  return parsed.success
    ? { status: "ready", marker: parsed.data }
    : { status: "invalid" };
}

async function ensurePrivateLocalDirectory(
  dataRoot: string
): Promise<void> {
  const directory = join(dataRoot, ".local");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !isOwnedByCurrentUser(metadata.uid)
    ) {
      throw new Error("unsafe local directory");
    }
    await chmod(directory, 0o700);
  } catch {
    throw new RootContextStoreError("ROOT_MARKER_WRITE_FAILED");
  }
}

async function prepareOwnedMarkerStorage(
  dataRoot: string
): Promise<void> {
  await ensurePrivateLocalDirectory(dataRoot);
  const target = rootMarkerPath(dataRoot);
  const metadata = await safeLstat(target);
  if (metadata === null) return;
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !isOwnedByCurrentUser(metadata.uid)
  ) {
    throw new RootContextStoreError("ROOT_MARKER_INVALID");
  }
  try {
    await chmod(target, 0o600);
  } catch {
    throw new RootContextStoreError("ROOT_MARKER_WRITE_FAILED");
  }
}

async function readPrivateBoundedFile(
  path: string,
  maxBytes: number
): Promise<string | null> {
  const metadata = await safeLstat(path);
  if (
    metadata === null ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !isOwnedByCurrentUser(metadata.uid) ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size <= 0 ||
    metadata.size > maxBytes
  ) {
    return null;
  }
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function isOwnedByCurrentUser(uid: number): boolean {
  const currentUid = process.getuid?.();
  return currentUid === undefined || uid === currentUid;
}

async function safeLstat(
  path: string
): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT") || isNodeError(error, "ENOTDIR")) {
      return null;
    }
    return null;
  }
}

function assertAbsoluteRoot(dataRoot: string): void {
  if (!isAbsolute(dataRoot)) {
    throw new RootContextStoreError("INVALID_ROOT");
  }
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
