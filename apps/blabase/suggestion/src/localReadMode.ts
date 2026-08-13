import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type LocalReadMode = "maintain" | "preserve";

export type LocalPrivateDirectoryChainStatus =
  | "available"
  | "missing";

/**
 * Treats `trustedRoot` as the caller-provided trust anchor, then validates
 * every controlled directory below it. Missing components are distinct from
 * dangling or redirecting symlinks, which always fail closed.
 */
export async function inspectLocalPrivateDirectoryChain(
  trustedRoot: string,
  directory: string
): Promise<LocalPrivateDirectoryChainStatus> {
  const root = resolve(trustedRoot);
  const target = resolve(directory);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error("Local preserve read escaped its trusted root.");
  }

  const expectedUid = process.geteuid?.() ?? process.getuid?.();
  const rootMetadata = await lstat(root);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (expectedUid !== undefined && rootMetadata.uid !== expectedUid)
  ) {
    throw new Error("Local preserve read requires a trusted directory root.");
  }

  let current = root;
  for (const component of relativeTarget.split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, component);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return "missing";
      throw error;
    }
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      (expectedUid !== undefined && metadata.uid !== expectedUid)
    ) {
      throw new Error(
        "Local preserve read requires a private directory chain."
      );
    }
  }
  return "available";
}

/**
 * Reads a connector file without changing the historical maintain-mode
 * behavior. Preserve mode pins the opened inode, refuses non-private or
 * non-regular files, and rejects a file that changes while it is read.
 */
export async function readLocalPrivateText(
  path: string,
  mode: LocalReadMode,
  trustedRoot: string
): Promise<string> {
  if (mode === "maintain") {
    return readFile(path, "utf8");
  }

  const expectedUid = process.geteuid?.() ?? process.getuid?.();
  if (
    (await inspectLocalPrivateDirectoryChain(
      trustedRoot,
      dirname(path)
    )) !== "available"
  ) {
    throw new Error("Local preserve read requires a private directory.");
  }

  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const before = await handle.stat();
    const pathBefore = await lstat(path);
    if (
      !before.isFile() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      before.dev !== pathBefore.dev ||
      before.ino !== pathBefore.ino ||
      (before.mode & 0o777) !== 0o600 ||
      (expectedUid !== undefined && before.uid !== expectedUid)
    ) {
      throw new Error("Local preserve read requires a private regular file.");
    }

    const text = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.mode !== pathAfter.mode ||
      after.size !== pathAfter.size ||
      after.mtimeMs !== pathAfter.mtimeMs ||
      after.ctimeMs !== pathAfter.ctimeMs
    ) {
      throw new Error("Local preserve read observed a changing file.");
    }
    if (
      (await inspectLocalPrivateDirectoryChain(
        trustedRoot,
        dirname(path)
      )) !== "available"
    ) {
      throw new Error("Local preserve read observed a changing directory.");
    }
    return text;
  } finally {
    await handle.close();
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
