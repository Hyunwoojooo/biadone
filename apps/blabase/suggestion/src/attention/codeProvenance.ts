import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  dirname,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";

import { createSharedLocalEnvSnapshot } from "../localEnv";
import type { LocalReadMode } from "../localReadMode";

export type AttentionCodeProvenance = {
  codeCommitSha: string | null;
  codeState:
    | "clean_commit"
    | "declared_commit"
    | "dirty_worktree"
    | "unavailable";
  codeFingerprintSha256: string | null;
};

const execFileAsync = promisify(execFile);
const GIT_EXECUTABLE = "/usr/bin/git";
const GIT_TIMEOUT_MS = 10_000;

export type AttentionCodeProvenanceResolutionOptions = {
  mode?: LocalReadMode;
};

export async function resolveAttentionCodeProvenance(
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: AttentionCodeProvenanceResolutionOptions = {}
): Promise<AttentionCodeProvenance> {
  let declaredEnv = env;
  if (options.mode === "preserve") {
    try {
      declaredEnv = createSharedLocalEnvSnapshot(env, {
        mode: "preserve"
      });
    } catch {
      return unavailableCodeProvenance();
    }
  }
  const explicitCommit =
    declaredEnv.BLABASE_CODE_COMMIT_SHA?.trim().toLowerCase();
  if (explicitCommit && /^[a-f0-9]{40}$/.test(explicitCommit)) {
    return {
      codeCommitSha: explicitCommit,
      codeState: "declared_commit",
      codeFingerprintSha256: null
    };
  }
  const declaredFingerprint =
    declaredEnv.BLABASE_CODE_FINGERPRINT_SHA256?.trim().toLowerCase();
  if (
    declaredFingerprint &&
    /^[a-f0-9]{64}$/.test(declaredFingerprint)
  ) {
    return {
      codeCommitSha: null,
      codeState: "dirty_worktree",
      codeFingerprintSha256: declaredFingerprint
    };
  }
  for (const value of [
    declaredEnv.CF_PAGES_COMMIT_SHA,
    declaredEnv.VERCEL_GIT_COMMIT_SHA,
    declaredEnv.GITHUB_SHA
  ]) {
    const normalized = value?.trim().toLowerCase();
    if (normalized && /^[a-f0-9]{40}$/.test(normalized)) {
      return {
        codeCommitSha: normalized,
        codeState: "declared_commit",
        codeFingerprintSha256: null
      };
    }
  }
  if (options.mode === "preserve") {
    return unavailableCodeProvenance();
  }
  const repository = await resolveGitRepository(cwd);
  if (!repository) {
    return unavailableCodeProvenance();
  }
  try {
    const scope = relative(repository.root, cwd) || ".";
    const options = {
      cwd: repository.root,
      encoding: "utf8" as const,
      env: gitEnvironment(),
      killSignal: "SIGKILL" as const,
      maxBuffer: 32 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS
    };
    const gitConfig = [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false"
    ];
    const status = (
      await execFileAsync(
        GIT_EXECUTABLE,
        [
          ...gitConfig,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--",
          scope
        ],
        options
      )
    ).stdout;
    if (status.length === 0) {
      return {
        codeCommitSha: repository.head,
        codeState: "clean_commit",
        codeFingerprintSha256: null
      };
    }
    const diff = (
      await execFileAsync(
        GIT_EXECUTABLE,
        [
          ...gitConfig,
          "diff",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
          "HEAD",
          "--",
          scope
        ],
        options
      )
    ).stdout;
    const untracked = (
      await execFileAsync(
        GIT_EXECUTABLE,
        [
          ...gitConfig,
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          scope
        ],
        options
      )
    ).stdout
      .split("\0")
      .filter(Boolean)
      .sort();
    const fingerprint = createHash("sha256")
      .update("blabase-dirty-code-fingerprint-v1\0")
      .update(repository.head)
      .update("\0")
      .update(status)
      .update("\0")
      .update(diff);
    for (const path of untracked) {
      const absolutePath = resolve(repository.root, path);
      if (
        absolutePath !== repository.root &&
        !absolutePath.startsWith(`${repository.root}${sep}`)
      ) {
        throw new Error("UNSAFE_UNTRACKED_PATH");
      }
      fingerprint.update("\0");
      fingerprint.update(path);
      fingerprint.update("\0");
      fingerprint.update(await readFile(absolutePath));
    }
    return {
      codeCommitSha: null,
      codeState: "dirty_worktree",
      codeFingerprintSha256: fingerprint.digest("hex")
    };
  } catch {
    return unavailableCodeProvenance();
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    NODE_ENV: "production"
  };
}

export function unavailableCodeProvenance(): AttentionCodeProvenance {
  return {
    codeCommitSha: null,
    codeState: "unavailable",
    codeFingerprintSha256: null
  };
}

async function resolveGitRepository(
  cwd: string
): Promise<{ root: string; head: string } | null> {
  let directory = cwd;
  for (let depth = 0; depth < 10; depth += 1) {
    const gitDirectory = join(directory, ".git");
    try {
      const head = await readGitHead(gitDirectory);
      if (head) return { root: directory, head };
    } catch {
      // Continue towards the repository root.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function readGitHead(gitDirectory: string): Promise<string | null> {
  const head = (await readFile(join(gitDirectory, "HEAD"), "utf8"))
    .trim()
    .toLowerCase();
  if (/^[a-f0-9]{40}$/.test(head)) return head;
  if (!head.startsWith("ref: ")) return null;
  const reference = head.slice(5).trim();
  try {
    const resolvedHead = (
      await readFile(join(gitDirectory, reference), "utf8")
    )
      .trim()
      .toLowerCase();
    return /^[a-f0-9]{40}$/.test(resolvedHead)
      ? resolvedHead
      : null;
  } catch {
    const packed = await readFile(
      join(gitDirectory, "packed-refs"),
      "utf8"
    );
    const match = packed
      .split("\n")
      .map((line) => line.trim().split(" "))
      .find(
        ([sha, name]) =>
          name === reference && /^[a-f0-9]{40}$/.test(sha)
      );
    return match?.[0] ?? null;
  }
}
