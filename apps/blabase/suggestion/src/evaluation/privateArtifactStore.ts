import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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
  const sha256 = createHash("sha256").update(bytes).digest("hex");
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
