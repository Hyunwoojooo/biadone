import { lstat, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class M0SafetyError extends Error {
  constructor(message, code = "unsafe_path") {
    super(message);
    this.name = "M0SafetyError";
    this.code = code;
  }
}

function isStrictDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function assertTemporaryRoot(candidate, label) {
  const [temporaryRoot, resolvedCandidate] = await Promise.all([
    realpath(os.tmpdir()),
    realpath(candidate),
  ]);

  if (!isStrictDescendant(temporaryRoot, resolvedCandidate)) {
    throw new M0SafetyError(`${label} must be a strict descendant of os.tmpdir() in the M0 spike`);
  }

  return resolvedCandidate;
}

export async function prepareTemporaryStorage(storageRoot, repoRoot) {
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const [resolvedStorage, resolvedRepo] = await Promise.all([
    assertTemporaryRoot(storageRoot, "storageRoot"),
    assertTemporaryRoot(repoRoot, "repoRoot"),
  ]);

  if (
    isStrictDescendant(resolvedRepo, resolvedStorage) ||
    isStrictDescendant(resolvedStorage, resolvedRepo) ||
    resolvedStorage === resolvedRepo
  ) {
    throw new M0SafetyError("storageRoot and the fixture repository must not contain one another");
  }

  return resolvedStorage;
}

export function normalizeRepoRelative(input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0") || input.includes("\\")) {
    throw new M0SafetyError("repository paths must be non-empty POSIX strings");
  }
  if (path.posix.isAbsolute(input)) {
    throw new M0SafetyError(`absolute repository path rejected: ${input}`);
  }

  const normalized = path.posix.normalize(input);
  const segments = normalized.split("/");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    segments.includes("..") ||
    segments[0] === ".git"
  ) {
    throw new M0SafetyError(`repository path escape rejected: ${input}`);
  }

  return normalized;
}

export function resolveRepoPath(repoRoot, relativePath) {
  const normalized = normalizeRepoRelative(relativePath);
  const candidate = path.resolve(repoRoot, ...normalized.split("/"));
  if (!isStrictDescendant(repoRoot, candidate)) {
    throw new M0SafetyError(`repository path escape rejected: ${relativePath}`);
  }
  return { normalized, absolute: candidate };
}

export async function assertNoSymlinkParents(repoRoot, relativePath) {
  const normalized = normalizeRepoRelative(relativePath);
  const segments = normalized.split("/");
  let cursor = repoRoot;

  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = await lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new M0SafetyError(`symlink parent rejected: ${relativePath}`);
    }
  }
}

export function isPathOwned(relativePath, ownedPaths) {
  return ownedPaths.some((scope) => {
    if (scope.endsWith("/**")) {
      const prefix = scope.slice(0, -3).replace(/\/$/, "");
      return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
    }
    if (scope.endsWith("/")) {
      const prefix = scope.slice(0, -1);
      return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
    }
    return relativePath === scope;
  });
}
