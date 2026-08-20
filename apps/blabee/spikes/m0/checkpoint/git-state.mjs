import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";

import {
  assertNoSymlinkParents,
  assertTemporaryRoot,
  M0SafetyError,
  normalizeRepoRelative,
  resolveRepoPath,
} from "./safety.mjs";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

export async function runGit(repoRoot, args, { allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", repoRoot, ...args], {
      encoding: "buffer",
      maxBuffer: MAX_GIT_OUTPUT,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    if (allowFailure) {
      return {
        ok: false,
        stdout: Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.from(error.stdout ?? ""),
        stderr: Buffer.isBuffer(error.stderr) ? error.stderr : Buffer.from(error.stderr ?? ""),
        error,
      };
    }
    throw error;
  }
}

async function runGitWithInput(repoRoot, args, input) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repoRoot, ...args], {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;

    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_GIT_OUTPUT) {
        child.kill();
        reject(new Error("git output exceeded M0 buffer limit"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(new Error(`git ${args[0]} failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`));
      }
    });
    child.stdin.end(input);
  });
}

function splitNul(buffer) {
  const parts = [];
  let offset = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index !== buffer.length && buffer[index] !== 0) continue;
    if (index > offset) {
      const bytes = buffer.subarray(offset, index);
      const decoded = bytes.toString("utf8");
      if (!Buffer.from(decoded, "utf8").equals(bytes)) {
        throw new M0SafetyError("non-UTF-8 Git path rejected by the M0 spike");
      }
      parts.push(decoded);
    }
    offset = index + 1;
  }
  return parts;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function resolveGitRepository(repoRoot) {
  const resolvedInput = await assertTemporaryRoot(repoRoot, "repoRoot");
  const result = await runGit(resolvedInput, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (!result.ok) return null;

  const discovered = await realpath(result.stdout.toString("utf8").trim());
  if (discovered !== resolvedInput) return null;
  return discovered;
}

export async function resolveGitDir(repoRoot) {
  const result = await runGit(repoRoot, ["rev-parse", "--absolute-git-dir"]);
  return await realpath(result.stdout.toString("utf8").trim());
}

export async function repositoryIdentity(repoRoot) {
  const [headResult, branchResult] = await Promise.all([
    runGit(repoRoot, ["rev-parse", "HEAD"], { allowFailure: true }),
    runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true }),
  ]);
  if (!headResult.ok) return null;
  return {
    head: headResult.stdout.toString("utf8").trim(),
    branch: branchResult.ok ? branchResult.stdout.toString("utf8").trim() : "DETACHED",
  };
}

async function repositoryCapabilities(repoRoot) {
  const fileMode = await runGit(repoRoot, ["config", "--bool", "core.filemode"], {
    allowFailure: true,
  });
  return {
    coreFileMode: fileMode.ok && fileMode.stdout.toString("utf8").trim() === "true",
  };
}

export async function isClean(repoRoot) {
  const result = await runGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  return result.stdout.length === 0;
}

async function listPaths(repoRoot, args) {
  const result = await runGit(repoRoot, args);
  return splitNul(result.stdout).map(normalizeRepoRelative).sort();
}

async function listChangedPaths(repoRoot) {
  const [unstaged, staged, untracked] = await Promise.all([
    listPaths(repoRoot, ["diff", "--name-only", "--no-renames", "-z", "--"]),
    listPaths(repoRoot, ["diff", "--cached", "--name-only", "--no-renames", "-z", "--"]),
    listPaths(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--"]),
  ]);
  const changedPaths = [...new Set([...unstaged, ...staged, ...untracked])].sort();
  return { unstaged, staged, untracked, changedPaths };
}

export function parseIndexEntries(buffer) {
  const entries = [];
  for (const record of splitNul(buffer)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const metadata = record.slice(0, tab).split(" ");
    const relativePath = normalizeRepoRelative(record.slice(tab + 1));
    entries.push({
      mode: metadata[0],
      oid: metadata[1],
      stage: Number(metadata[2]),
      path: relativePath,
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path) || left.stage - right.stage);
}

async function listIndexEntries(repoRoot) {
  const result = await runGit(repoRoot, ["ls-files", "--stage", "-z"]);
  return { raw: result.stdout, parsed: parseIndexEntries(result.stdout) };
}

async function listUnsupportedIndexFlags(repoRoot) {
  const result = await runGit(repoRoot, ["ls-files", "-v", "-z"]);
  return splitNul(result.stdout)
    .map((record) => ({
      tag: record.slice(0, 1),
      path: normalizeRepoRelative(record.slice(2)),
    }))
    .filter((entry) => entry.tag !== "H")
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function captureTrackedMetadata(repoRoot, trackedPaths) {
  return await Promise.all(
    trackedPaths.map(async (relativePath) => {
      const { normalized, absolute } = resolveRepoPath(repoRoot, relativePath);
      await assertNoSymlinkParents(repoRoot, normalized);
      try {
        const stat = await lstat(absolute);
        const kind = stat.isFile()
          ? "file"
          : stat.isSymbolicLink()
            ? "symlink"
            : stat.isDirectory()
              ? "directory"
              : "unsupported";
        return {
          path: normalized,
          kind,
          // Git tracks only the executable bit. Preserve the remaining POSIX
          // mode bits as an explicit safety signal rather than claiming reset
          // can restore them.
          nonGitMode: kind === "file" ? stat.mode & 0o7666 : null,
        };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return { path: normalized, kind: "missing", nonGitMode: null };
        }
        throw error;
      }
    }),
  );
}

export async function capturePathEntry(repoRoot, relativePath) {
  const { normalized, absolute } = resolveRepoPath(repoRoot, relativePath);
  await assertNoSymlinkParents(repoRoot, normalized);
  let stat;
  try {
    stat = await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return { path: normalized, kind: "missing", mode: null, size: 0, digest: null };
    throw error;
  }

  const mode = stat.mode & 0o7777;
  if (stat.isSymbolicLink()) {
    const target = await readlink(absolute);
    const bytes = Buffer.from(target, "utf8");
    return { path: normalized, kind: "symlink", mode, size: bytes.length, digest: sha256(bytes), target };
  }
  if (stat.isFile()) {
    return { path: normalized, kind: "file", mode, size: stat.size, digest: await hashFile(absolute) };
  }
  if (stat.isDirectory()) {
    return { path: normalized, kind: "directory", mode, size: 0, digest: null };
  }
  return { path: normalized, kind: "unsupported", mode, size: stat.size, digest: null };
}

async function captureEntries(repoRoot, paths) {
  return await Promise.all(paths.map((relativePath) => capturePathEntry(repoRoot, relativePath)));
}

async function lfsPaths(repoRoot, trackedPaths) {
  if (trackedPaths.length === 0) return [];
  const input = Buffer.from(`${trackedPaths.join("\0")}\0`, "utf8");
  const output = await runGitWithInput(repoRoot, ["check-attr", "--cached", "-z", "--stdin", "filter"], input);
  const fields = splitNul(output);
  const matches = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [filename, attribute, value] = fields.slice(index, index + 3);
    if (attribute === "filter" && value === "lfs") matches.push(normalizeRepoRelative(filename));
  }
  return matches.sort();
}

async function captureSubmodules(repoRoot, indexEntries) {
  const gitlinks = indexEntries.filter((entry) => entry.mode === "160000" && entry.stage === 0);
  const result = [];
  for (const entry of gitlinks) {
    const { absolute } = resolveRepoPath(repoRoot, entry.path);
    const head = await runGit(absolute, ["rev-parse", "HEAD"], { allowFailure: true });
    const status = await runGit(absolute, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { allowFailure: true });
    result.push({
      path: entry.path,
      indexOid: entry.oid,
      checkoutHead: head.ok ? head.stdout.toString("utf8").trim() : null,
      checkoutStatus: status.ok ? status.stdout.toString("base64") : null,
    });
  }
  return result;
}

function digestObject(value) {
  return sha256(Buffer.from(JSON.stringify(value), "utf8"));
}

export async function captureRepositoryState(repoRoot) {
  const [identity, capabilities, status, index, ignoredPaths, unsupportedIndexFlags] = await Promise.all([
    repositoryIdentity(repoRoot),
    repositoryCapabilities(repoRoot),
    listChangedPaths(repoRoot),
    listIndexEntries(repoRoot),
    listPaths(repoRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--"]),
    listUnsupportedIndexFlags(repoRoot),
  ]);
  if (!identity) throw new Error("repository HEAD is unavailable");

  const trackedPaths = index.parsed.filter((entry) => entry.stage === 0).map((entry) => entry.path);
  const trackedLfsPaths = await lfsPaths(repoRoot, trackedPaths);
  const [entries, ignored, lfs, submodules, trackedMetadata] = await Promise.all([
    captureEntries(repoRoot, status.changedPaths),
    captureEntries(repoRoot, ignoredPaths),
    captureEntries(repoRoot, trackedLfsPaths),
    captureSubmodules(repoRoot, index.parsed),
    captureTrackedMetadata(repoRoot, trackedPaths),
  ]);

  const state = {
    ...identity,
    capabilities,
    indexEntries: index.raw.toString("base64"),
    indexDigest: sha256(index.raw),
    status,
    entries,
    ignored,
    lfs,
    submodules,
    unsupportedIndexFlags,
    trackedMetadata,
  };
  state.digest = digestObject(state);
  return state;
}

export function excludedStateDigest(state) {
  return digestObject({ ignored: state.ignored, lfs: state.lfs, submodules: state.submodules });
}

export async function calculateBoundaryBytes(repoRoot, state, baselineState = null) {
  const sizes = state.entries
    .filter((entry) => entry.kind === "file" || entry.kind === "symlink")
    .map((entry) => ({ path: entry.path, source: "worktree", bytes: entry.size }));

  const changed = new Set(state.status.changedPaths);
  const parsed = [
    ...parseIndexEntries(Buffer.from(state.indexEntries, "base64")),
    ...(baselineState ? parseIndexEntries(Buffer.from(baselineState.indexEntries, "base64")) : []),
  ];
  const measuredObjects = new Set();
  for (const entry of parsed) {
    if (!changed.has(entry.path) || entry.stage !== 0 || entry.mode === "160000") continue;
    const objectKey = `${entry.path}\0${entry.oid}`;
    if (measuredObjects.has(objectKey)) continue;
    measuredObjects.add(objectKey);
    const sizeResult = await runGit(repoRoot, ["cat-file", "-s", entry.oid], { allowFailure: true });
    if (sizeResult.ok) {
      sizes.push({ path: entry.path, source: "git_object", bytes: Number(sizeResult.stdout.toString("utf8").trim()) });
    }
  }

  const gitDir = await resolveGitDir(repoRoot);
  const indexPath = path.join(gitDir, "index");
  const indexStat = await lstat(indexPath);
  return {
    files: sizes,
    indexBytes: indexStat.size,
    totalBytes: sizes.reduce((sum, item) => sum + item.bytes, indexStat.size),
    indexPath,
  };
}
