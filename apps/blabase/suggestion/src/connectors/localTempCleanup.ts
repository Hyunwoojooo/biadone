import { lstat, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export const CONNECTOR_TEMP_FILE_GRACE_MS = 5 * 60 * 1_000;
const activeConnectorTempFiles = new Set<string>();

type CleanupStaleConnectorTempFilesOptions = {
  directory: string;
  canonicalBasenames: readonly string[];
  nowMs?: number;
  graceMs?: number;
  removeFresh?: boolean;
};

export async function withActiveConnectorTempFile<T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  const normalizedPath = resolve(path);
  activeConnectorTempFiles.add(normalizedPath);
  try {
    return await operation();
  } finally {
    activeConnectorTempFiles.delete(normalizedPath);
  }
}

/**
 * Removes only abandoned files created by connector atomic JSON writes.
 *
 * Startup cleanup preserves recent files because they may still belong to a
 * writer. Explicit disconnect may set removeFresh after its serialized
 * generation change; paths registered by this process remain protected in
 * either mode. Canonical files, symlinks, directories, and unrecognized
 * basenames are never touched.
 */
export async function cleanupStaleConnectorTempFiles({
  directory,
  canonicalBasenames,
  nowMs = Date.now(),
  graceMs = CONNECTOR_TEMP_FILE_GRACE_MS,
  removeFresh = false
}: CleanupStaleConnectorTempFilesOptions): Promise<string[]> {
  const allowedBasenames = new Set(canonicalBasenames);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const recognized = isConnectorTempBasename(
      entry.name,
      allowedBasenames
    );
    if (!recognized) continue;

    const path = join(directory, entry.name);
    if (activeConnectorTempFiles.has(resolve(path))) continue;
    let modifiedAtMs: number;
    try {
      modifiedAtMs = (await lstat(path)).mtimeMs;
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    if (!removeFresh && nowMs - modifiedAtMs <= graceMs) continue;

    try {
      await unlink(path);
      removed.push(entry.name);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  return removed;
}

function isConnectorTempBasename(
  basename: string,
  allowedBasenames: ReadonlySet<string>
): boolean {
  const match = /^(.+)\.([1-9]\d*)\.([a-f0-9]{16})\.tmp$/.exec(
    basename
  );
  return Boolean(match && allowedBasenames.has(match[1]));
}

function isMissingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
