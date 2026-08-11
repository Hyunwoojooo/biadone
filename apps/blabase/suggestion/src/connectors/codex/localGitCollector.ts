import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import {
  isAbsolute,
  parse as parsePath,
  relative,
  resolve as resolvePath
} from "node:path";

import type { StoredCodexScope } from "./types";
import {
  CODEX_LOCAL_GIT_COLLECTOR_VERSION,
  CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION,
  CODEX_LOCAL_GIT_UPSTREAM_BASIS,
  MAX_CODEX_LOCAL_GIT_REPOSITORIES,
  MAX_CODEX_LOCAL_GIT_TRACKING_COUNT,
  createCodexLocalGitGitHubRepositoryKey,
  createCodexLocalGitHeadCommitId,
  createCodexLocalGitRepositoryId,
  sealCodexLocalGitSnapshot,
  type CodexLocalGitRepository,
  type CodexLocalGitSnapshot,
  type CodexLocalGitUnavailableReason
} from "./localGitContracts";

export const CODEX_LOCAL_GIT_COMMAND_TIMEOUT_MS = 2_000;
export const CODEX_LOCAL_GIT_MAX_BUFFER_BYTES = 32 * 1_024;
export const CODEX_LOCAL_GIT_MAX_CONCURRENCY = 4;
export const CODEX_LOCAL_GIT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const CODEX_LOCAL_GIT_EXECUTABLE = "/usr/bin/git" as const;
const CODEX_LOCAL_GIT_MAX_REMOTES = 16;

export const CODEX_LOCAL_GIT_COMMAND_ARGUMENTS = {
  repository_root: ["rev-parse", "--show-toplevel"],
  inside_work_tree: ["rev-parse", "--is-inside-work-tree"],
  head_commit: ["rev-parse", "--verify", "--quiet", "HEAD"],
  head_committed_at: ["show", "-s", "--no-patch", "--format=%cI"],
  remote_names: [
    "config",
    "--local",
    "--name-only",
    "--get-regexp",
    "^remote\\.[a-zA-Z0-9_.-]+\\.url$"
  ],
  remote_url: ["config", "--local", "--get-all"],
  upstream_commit: [
    "rev-parse",
    "--verify",
    "--quiet",
    "@{upstream}"
  ],
  tracking_counts: [
    "rev-list",
    "--left-right",
    "--count"
  ]
} as const;

export type CodexLocalGitCommand =
  keyof typeof CODEX_LOCAL_GIT_COMMAND_ARGUMENTS;

export type CodexLocalGitCommandResult =
  | {
      status: "exited";
      exitCode: number;
      stdout: string;
    }
  | {
      status: "failed";
      reason: "timeout" | "unavailable" | "execution_failed";
    };

type CodexLocalGitFixedCommand = Exclude<
  CodexLocalGitCommand,
  "head_committed_at" | "tracking_counts" | "remote_url"
>;

type CodexLocalGitCommandInvocation =
  | {
      command: CodexLocalGitFixedCommand;
      cwd: string;
    }
  | {
      command: "head_committed_at";
      cwd: string;
      oid: string;
    }
  | {
      command: "tracking_counts";
      cwd: string;
      headOid: string;
      upstreamOid: string;
    }
  | {
      command: "remote_url";
      cwd: string;
      configKey: string;
    };

export type CodexLocalGitCommandRequest =
  CodexLocalGitCommandInvocation & {
    timeoutMs: number;
    maxBufferBytes: number;
  };

export type CodexLocalGitCommandRunner = (
  input: CodexLocalGitCommandRequest
) => Promise<CodexLocalGitCommandResult>;

export type CollectCodexLocalGitSnapshotInput = {
  installationSecret: string;
  scopes: StoredCodexScope[];
  observedAt: string;
  runCommand?: CodexLocalGitCommandRunner;
  homePath?: string;
};

export async function collectCodexLocalGitSnapshot(
  input: CollectCodexLocalGitSnapshotInput
): Promise<CodexLocalGitSnapshot> {
  if (!/^[a-f0-9]{64}$/u.test(input.installationSecret)) {
    throw new TypeError("Invalid Local Git installation identity.");
  }
  const fetchedAt = normalizeObservedAt(input.observedAt);
  const selectedScopes = [
    ...new Map(input.scopes.map((scope) => [scope.id, scope])).values()
  ].sort((left, right) => left.id.localeCompare(right.id));
  const retainedScopes = selectedScopes.slice(
    0,
    MAX_CODEX_LOCAL_GIT_REPOSITORIES
  );
  const homeRealPath = await realpath(input.homePath ?? homedir());
  const runCommand = input.runCommand ?? runAllowedGitCommand;
  const repositories = await mapWithConcurrency(
    retainedScopes,
    CODEX_LOCAL_GIT_MAX_CONCURRENCY,
    (scope) =>
      collectScope({
        scope,
        installationSecret: input.installationSecret,
        fetchedAt,
        homeRealPath,
        runCommand
      })
  );
  return sealCodexLocalGitSnapshot({
    schemaVersion: CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION,
    collectorVersion: CODEX_LOCAL_GIT_COLLECTOR_VERSION,
    upstreamBasis: CODEX_LOCAL_GIT_UPSTREAM_BASIS,
    fetchedAt,
    scopeIds: retainedScopes.map((scope) => scope.id),
    repositories,
    truncated: retainedScopes.length !== selectedScopes.length
  });
}

async function collectScope(input: {
  scope: StoredCodexScope;
  installationSecret: string;
  fetchedAt: string;
  homeRealPath: string;
  runCommand: CodexLocalGitCommandRunner;
}): Promise<CodexLocalGitRepository> {
  const safeScope = await safeDirectory(
    input.scope.queryPath,
    input.homeRealPath
  );
  if (!safeScope.ok) {
    return unavailable(input.scope.id, safeScope.reason);
  }

  const rootResult = await run(input.runCommand, {
    command: "repository_root",
    cwd: safeScope.path
  });
  if (rootResult.status === "failed") {
    return unavailable(
      input.scope.id,
      commandFailureReason(rootResult.reason)
    );
  }
  if (rootResult.exitCode !== 0) {
    return unavailable(input.scope.id, "NOT_A_REPOSITORY");
  }
  const rootOutput = singleLine(rootResult.stdout);
  if (rootOutput === null || !isAbsolute(rootOutput)) {
    return unavailable(input.scope.id, "GIT_OUTPUT_INVALID");
  }
  const safeRoot = await safeDirectory(rootOutput, input.homeRealPath);
  if (
    !safeRoot.ok ||
    !containsPath(safeRoot.path, safeScope.path)
  ) {
    return unavailable(input.scope.id, "UNSAFE_SCOPE_PATH");
  }

  const insideResult = await run(input.runCommand, {
    command: "inside_work_tree",
    cwd: safeRoot.path
  });
  if (
    insideResult.status === "failed" ||
    insideResult.exitCode !== 0 ||
    insideResult.stdout.trim() !== "true"
  ) {
    return unavailable(
      input.scope.id,
      insideResult.status === "failed"
        ? commandFailureReason(insideResult.reason)
        : "NOT_A_REPOSITORY"
    );
  }

  const repositoryId = createCodexLocalGitRepositoryId(
    input.installationSecret,
    safeRoot.path
  );
  const mapping = await collectGitHubMapping(
    input.runCommand,
    safeRoot.path,
    input.installationSecret
  );
  const base = {
    scopeId: input.scope.id,
    repositoryId,
    githubRepositoryKey: mapping.key,
    mappingEligibility: mapping.eligibility
  } as const;

  const headResult = await run(input.runCommand, {
    command: "head_commit",
    cwd: safeRoot.path
  });
  if (headResult.status === "failed") {
    return unavailable(
      input.scope.id,
      commandFailureReason(headResult.reason),
      base
    );
  }
  if (headResult.exitCode === 1) {
    const refFailure = await verifyResolvedRef(
      input.runCommand,
      safeRoot.path,
      "head_commit",
      null
    );
    if (refFailure !== null) {
      return unavailable(input.scope.id, refFailure, base);
    }
    return {
      ...base,
      headCommitId: null,
      trackingState: "unborn",
      aheadCount: null,
      behindCount: null,
      headCommittedAt: null,
      unavailableReason: null
    };
  }
  const rawHeadValue = singleLine(headResult.stdout);
  if (
    headResult.exitCode !== 0 ||
    rawHeadValue === null ||
    !isGitOid(rawHeadValue)
  ) {
    return unavailable(
      input.scope.id,
      "GIT_OUTPUT_INVALID",
      base
    );
  }
  const rawHead = rawHeadValue.toLowerCase();

  const timeResult = await run(input.runCommand, {
    command: "head_committed_at",
    cwd: safeRoot.path,
    oid: rawHead
  });
  if (timeResult.status === "failed" || timeResult.exitCode !== 0) {
    return unavailable(
      input.scope.id,
      timeResult.status === "failed"
        ? commandFailureReason(timeResult.reason)
        : "GIT_EXECUTION_FAILED",
      base
    );
  }
  const headCommittedAt = normalizeGitTimestamp(
    timeResult.stdout,
    input.fetchedAt
  );
  if (headCommittedAt === null) {
    return unavailable(
      input.scope.id,
      "GIT_OUTPUT_INVALID",
      base
    );
  }
  const headCommitId = createCodexLocalGitHeadCommitId(
    input.installationSecret,
    safeRoot.path,
    rawHead
  );

  const upstreamResult = await run(input.runCommand, {
    command: "upstream_commit",
    cwd: safeRoot.path
  });
  if (upstreamResult.status === "failed") {
    return unavailable(
      input.scope.id,
      commandFailureReason(upstreamResult.reason),
      base
    );
  }
  if (upstreamResult.exitCode === 1) {
    const headFailure = await verifyResolvedRef(
      input.runCommand,
      safeRoot.path,
      "head_commit",
      rawHead
    );
    const upstreamFailure =
      headFailure === null
        ? await verifyResolvedRef(
            input.runCommand,
            safeRoot.path,
            "upstream_commit",
            null
          )
        : null;
    const refFailure = headFailure ?? upstreamFailure;
    if (refFailure !== null) {
      return unavailable(input.scope.id, refFailure, base);
    }
    return {
      ...base,
      headCommitId,
      trackingState: "not_configured",
      aheadCount: null,
      behindCount: null,
      headCommittedAt,
      unavailableReason: null
    };
  }
  const rawUpstreamValue = singleLine(upstreamResult.stdout);
  if (
    upstreamResult.exitCode !== 0 ||
    rawUpstreamValue === null ||
    !isGitOid(rawUpstreamValue)
  ) {
    return unavailable(
      input.scope.id,
      "GIT_OUTPUT_INVALID",
      base
    );
  }
  const rawUpstream = rawUpstreamValue.toLowerCase();

  const countsResult = await run(input.runCommand, {
    command: "tracking_counts",
    cwd: safeRoot.path,
    headOid: rawHead,
    upstreamOid: rawUpstream
  });
  if (countsResult.status === "failed" || countsResult.exitCode !== 0) {
    return unavailable(
      input.scope.id,
      countsResult.status === "failed"
        ? commandFailureReason(countsResult.reason)
        : "GIT_EXECUTION_FAILED",
      base
    );
  }
  const counts = parseTrackingCounts(countsResult.stdout);
  if (counts === null) {
    return unavailable(
      input.scope.id,
      "GIT_OUTPUT_INVALID",
      base
    );
  }
  const headFailure = await verifyResolvedRef(
    input.runCommand,
    safeRoot.path,
    "head_commit",
    rawHead
  );
  const upstreamFailure =
    headFailure === null
      ? await verifyResolvedRef(
          input.runCommand,
          safeRoot.path,
          "upstream_commit",
          rawUpstream
        )
      : null;
  const refFailure = headFailure ?? upstreamFailure;
  if (refFailure !== null) {
    return unavailable(input.scope.id, refFailure, base);
  }
  return {
    ...base,
    headCommitId,
    trackingState: trackingState(counts.ahead, counts.behind),
    aheadCount: counts.ahead,
    behindCount: counts.behind,
    headCommittedAt,
    unavailableReason: null
  };
}

async function collectGitHubMapping(
  runCommand: CodexLocalGitCommandRunner,
  cwd: string,
  installationSecret: string
): Promise<{
  key: string | null;
  eligibility: "exact" | "none" | "conflict";
}> {
  const namesResult = await run(runCommand, {
    command: "remote_names",
    cwd
  });
  if (
    namesResult.status === "failed" ||
    namesResult.exitCode !== 0
  ) {
    return { key: null, eligibility: "none" };
  }
  const configKeys = [
    ...new Set(
      namesResult.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(isExactRemoteUrlConfigKey)
    )
  ].sort();
  if (configKeys.length > CODEX_LOCAL_GIT_MAX_REMOTES) {
    return { key: null, eligibility: "conflict" };
  }
  const repositories = new Set<string>();
  for (const configKey of configKeys) {
    const urlResult = await run(runCommand, {
      command: "remote_url",
      cwd,
      configKey
    });
    if (urlResult.status === "failed" || urlResult.exitCode !== 0) {
      continue;
    }
    for (const line of urlResult.stdout.split(/\r?\n/u)) {
      const repository = githubRepositoryFromRemote(line.trim());
      if (repository !== null) repositories.add(repository);
    }
  }
  if (repositories.size === 0) {
    return { key: null, eligibility: "none" };
  }
  if (repositories.size !== 1) {
    return { key: null, eligibility: "conflict" };
  }
  const [repository] = repositories;
  return {
    key: createCodexLocalGitGitHubRepositoryKey(
      installationSecret,
      repository!
    ),
    eligibility: "exact"
  };
}

function isExactRemoteUrlConfigKey(value: string): boolean {
  return /^remote\.[a-zA-Z0-9_.-]{1,100}\.url$/u.test(value);
}

function githubRepositoryFromRemote(remote: string): string | null {
  const scp = remote.match(
    /^(?:[^@\s]+@)?github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/u
  );
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
  try {
    const url = new URL(remote);
    if (
      url.hostname.toLowerCase() !== "github.com" ||
      !["https:", "ssh:", "git:"].includes(url.protocol)
    ) {
      return null;
    }
    const parts = url.pathname
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/u, "")
      .split("/");
    if (
      parts.length !== 2 ||
      parts.some((part) => !/^[a-zA-Z0-9_.-]+$/u.test(part))
    ) {
      return null;
    }
    return `${parts[0]}/${parts[1]}`.toLowerCase();
  } catch {
    return null;
  }
}

async function safeDirectory(
  inputPath: string,
  homeRealPath: string
): Promise<
  | { ok: true; path: string }
  | { ok: false; reason: CodexLocalGitUnavailableReason }
> {
  if (!isAbsolute(inputPath)) {
    return { ok: false, reason: "UNSAFE_SCOPE_PATH" };
  }
  const normalized = resolvePath(inputPath);
  try {
    const [canonical, stats] = await Promise.all([
      realpath(normalized),
      lstat(normalized)
    ]);
    if (
      canonical !== normalized ||
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      canonical === parsePath(canonical).root ||
      canonical === homeRealPath
    ) {
      return { ok: false, reason: "UNSAFE_SCOPE_PATH" };
    }
    return { ok: true, path: canonical };
  } catch {
    return { ok: false, reason: "PATH_UNAVAILABLE" };
  }
}

function containsPath(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return (
    childRelative === "" ||
    (!childRelative.startsWith("..") && !isAbsolute(childRelative))
  );
}

function unavailable(
  scopeId: string,
  reason: CodexLocalGitUnavailableReason,
  known: {
    repositoryId: string;
    githubRepositoryKey: string | null;
    mappingEligibility: "exact" | "none" | "conflict";
  } | null = null
): CodexLocalGitRepository {
  return {
    scopeId,
    repositoryId: known?.repositoryId ?? null,
    headCommitId: null,
    githubRepositoryKey: known?.githubRepositoryKey ?? null,
    mappingEligibility: known?.mappingEligibility ?? "none",
    trackingState: "unavailable",
    aheadCount: null,
    behindCount: null,
    headCommittedAt: null,
    unavailableReason: reason
  };
}

function normalizeObservedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("Invalid Local Git observation timestamp.");
  }
  return new Date(timestamp).toISOString();
}

function normalizeGitTimestamp(
  value: string,
  fetchedAt: string
): string | null {
  const timestamp = Date.parse(value.trim());
  if (
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    timestamp >
      Date.parse(fetchedAt) + CODEX_LOCAL_GIT_MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function parseTrackingCounts(
  value: string
): { ahead: number; behind: number } | null {
  const match = value.trim().match(/^(\d+)\s+(\d+)$/u);
  if (!match) return null;
  const ahead = Number(match[1]);
  const behind = Number(match[2]);
  if (
    !Number.isSafeInteger(ahead) ||
    !Number.isSafeInteger(behind) ||
    ahead > MAX_CODEX_LOCAL_GIT_TRACKING_COUNT ||
    behind > MAX_CODEX_LOCAL_GIT_TRACKING_COUNT
  ) {
    return null;
  }
  return { ahead, behind };
}

function trackingState(
  ahead: number,
  behind: number
): "in_sync" | "ahead" | "behind" | "diverged" {
  if (ahead === 0 && behind === 0) return "in_sync";
  if (ahead > 0 && behind === 0) return "ahead";
  if (ahead === 0 && behind > 0) return "behind";
  return "diverged";
}

function singleLine(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[\r\n\0]/u.test(trimmed)
    ? trimmed
    : null;
}

function commandFailureReason(
  reason: "timeout" | "unavailable" | "execution_failed"
): CodexLocalGitUnavailableReason {
  if (reason === "timeout") return "GIT_COMMAND_TIMED_OUT";
  if (reason === "unavailable") return "GIT_UNAVAILABLE";
  return "GIT_EXECUTION_FAILED";
}

async function verifyResolvedRef(
  runner: CodexLocalGitCommandRunner,
  cwd: string,
  command: "head_commit" | "upstream_commit",
  expectedOid: string | null
): Promise<CodexLocalGitUnavailableReason | null> {
  const result = await run(runner, { command, cwd });
  if (result.status === "failed") {
    return commandFailureReason(result.reason);
  }
  if (expectedOid === null) {
    return result.exitCode === 1
      ? null
      : "GIT_REFS_CHANGED_DURING_COLLECTION";
  }
  if (result.exitCode !== 0) {
    return "GIT_REFS_CHANGED_DURING_COLLECTION";
  }
  const actualOid = singleLine(result.stdout);
  if (actualOid === null || !isGitOid(actualOid)) {
    return "GIT_OUTPUT_INVALID";
  }
  return actualOid.toLowerCase() === expectedOid
    ? null
    : "GIT_REFS_CHANGED_DURING_COLLECTION";
}

function isGitOid(value: string): boolean {
  return /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(value);
}

async function run(
  runner: CodexLocalGitCommandRunner,
  input: CodexLocalGitCommandInvocation
): Promise<CodexLocalGitCommandResult> {
  try {
    const request = {
      ...input,
      timeoutMs: CODEX_LOCAL_GIT_COMMAND_TIMEOUT_MS,
      maxBufferBytes: CODEX_LOCAL_GIT_MAX_BUFFER_BYTES
    } as CodexLocalGitCommandRequest;
    return await runner(request);
  } catch {
    return { status: "failed", reason: "execution_failed" };
  }
}

async function runAllowedGitCommand(
  input: CodexLocalGitCommandRequest
): Promise<CodexLocalGitCommandResult> {
  const args = createCodexLocalGitCommandArguments(input);
  if (args === null) {
    return { status: "failed", reason: "execution_failed" };
  }
  return new Promise((resolve) => {
    execFile(
      CODEX_LOCAL_GIT_EXECUTABLE,
      [...args],
      createCodexLocalGitExecFileOptions({
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        maxBufferBytes: input.maxBufferBytes
      }),
      (error, stdout) => {
        if (!error) {
          resolve({ status: "exited", exitCode: 0, stdout });
          return;
        }
        if (error.killed) {
          resolve({ status: "failed", reason: "timeout" });
          return;
        }
        if (typeof error.code === "number") {
          resolve({
            status: "exited",
            exitCode: error.code,
            stdout
          });
          return;
        }
        if (error.code === "ENOENT") {
          resolve({ status: "failed", reason: "unavailable" });
          return;
        }
        resolve({ status: "failed", reason: "execution_failed" });
      }
    );
  });
}

export function createCodexLocalGitCommandArguments(
  input: CodexLocalGitCommandRequest
): string[] | null {
  if (input.command === "head_committed_at") {
    if (!isGitOid(input.oid)) return null;
    return [
      ...CODEX_LOCAL_GIT_COMMAND_ARGUMENTS.head_committed_at,
      input.oid.toLowerCase()
    ];
  }
  if (input.command === "tracking_counts") {
    if (!isGitOid(input.headOid) || !isGitOid(input.upstreamOid)) {
      return null;
    }
    return [
      ...CODEX_LOCAL_GIT_COMMAND_ARGUMENTS.tracking_counts,
      `${input.headOid.toLowerCase()}...${input.upstreamOid.toLowerCase()}`
    ];
  }
  if (input.command === "remote_url") {
    if (!isExactRemoteUrlConfigKey(input.configKey)) return null;
    return [
      ...CODEX_LOCAL_GIT_COMMAND_ARGUMENTS.remote_url,
      input.configKey
    ];
  }
  return [...CODEX_LOCAL_GIT_COMMAND_ARGUMENTS[input.command]];
}

export function createCodexLocalGitExecFileOptions(input: {
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
}) {
  return {
    cwd: input.cwd,
    encoding: "utf8" as const,
    shell: false as const,
    timeout: input.timeoutMs,
    maxBuffer: input.maxBufferBytes,
    windowsHide: true as const,
    env: {
      NODE_ENV: "production" as const,
      HOME: "/var/empty",
      XDG_CONFIG_HOME: "/var/empty",
      LANG: "C",
      LC_ALL: "C",
      TERM: "dumb",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0"
    }
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  project: (value: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await project(values[index]!);
      }
    }
  );
  await Promise.all(workers);
  return output;
}
