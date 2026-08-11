import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEX_LOCAL_GIT_COMMAND_ARGUMENTS,
  CODEX_LOCAL_GIT_EXECUTABLE,
  collectCodexLocalGitSnapshot,
  createCodexLocalGitCommandArguments,
  createCodexLocalGitExecFileOptions,
  type CodexLocalGitCommandRunner
} from "../src/connectors/codex/localGitCollector";
import {
  createCodexLocalGitGitHubRepositoryKey,
  parseCodexLocalGitSnapshot,
  sealCodexLocalGitSnapshot
} from "../src/connectors/codex/localGitContracts";
import {
  codexLocalDirectory,
  codexStoreGeneration,
  readStoredCodexLocalGitSnapshot,
  transitionStoredCodexConfig,
  writeStoredCodexConfig,
  writeStoredCodexLocalGitSnapshot
} from "../src/connectors/codex/localStore";
import type {
  StoredCodexConfig,
  StoredCodexScope
} from "../src/connectors/codex/types";

const INSTALLATION_SECRET = "a".repeat(64);
const RAW_HEAD = "b".repeat(40);
const RAW_UPSTREAM = "c".repeat(40);
const OBSERVED_AT = "2026-08-09T03:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Codex private Local Git collector", () => {
  it("stores only opaque selected-scope metadata from a fixed local command allowlist", async () => {
    const repositoryPath = await createRepositoryDirectory();
    const rawRemote =
      "git@github.com:Private-Owner/Private-Repository.git";
    const runCommand = trackingRunner(repositoryPath, {
      ahead: 2,
      behind: 0,
      rawRemote
    });
    const scope = storedScope("1", repositoryPath);

    const first = await collectCodexLocalGitSnapshot({
      installationSecret: INSTALLATION_SECRET,
      scopes: [scope],
      observedAt: OBSERVED_AT,
      runCommand
    });
    const second = await collectCodexLocalGitSnapshot({
      installationSecret: INSTALLATION_SECRET,
      scopes: [scope],
      observedAt: OBSERVED_AT,
      runCommand: trackingRunner(repositoryPath, {
        ahead: 2,
        behind: 0,
        rawRemote
      })
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: "codex-local-git-snapshot-v1",
      collectorVersion: "codex-local-git-metadata-v1",
      upstreamBasis: "local_tracking_ref_without_network_refresh",
      scopeIds: [scope.id],
      truncated: false,
      repositories: [
        {
          scopeId: scope.id,
          repositoryId: expect.stringMatching(
            /^local_repo_[a-f0-9]{64}$/u
          ),
          headCommitId: expect.stringMatching(
            /^local_commit_[a-f0-9]{64}$/u
          ),
          githubRepositoryKey:
            createCodexLocalGitGitHubRepositoryKey(
              INSTALLATION_SECRET,
              "private-owner/private-repository"
            ),
          mappingEligibility: "exact",
          trackingState: "ahead",
          aheadCount: 2,
          behindCount: 0,
          headCommittedAt: "2026-08-09T02:00:00.000Z",
          unavailableReason: null
        }
      ]
    });
    const serialized = JSON.stringify(first);
    for (const forbidden of [
      repositoryPath,
      RAW_HEAD,
      RAW_UPSTREAM,
      rawRemote,
      "Private-Owner",
      "Private-Repository"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(
      /"(?:queryPath|branch|remote|message|diff|sha)"\s*:/u
    );
    const allowedArguments = Object.values(
      CODEX_LOCAL_GIT_COMMAND_ARGUMENTS
    ).flat();
    for (const forbiddenCommand of ["fetch", "pull", "push", "clone"]) {
      expect(allowedArguments).not.toContain(forbiddenCommand);
    }
    expect(
      CODEX_LOCAL_GIT_COMMAND_ARGUMENTS.head_committed_at
    ).not.toContain("HEAD");
    expect(
      CODEX_LOCAL_GIT_COMMAND_ARGUMENTS.tracking_counts.join(" ")
    ).not.toContain("@{upstream}");
    expect(CODEX_LOCAL_GIT_COMMAND_ARGUMENTS.remote_names).toEqual(
      expect.arrayContaining(["--local", "--name-only"])
    );
    const requests = vi
      .mocked(runCommand)
      .mock.calls.map(([request]) => request);
    expect(
      requests.find(
        (request) => request.command === "head_committed_at"
      )
    ).toMatchObject({ oid: RAW_HEAD });
    expect(
      requests.find(
        (request) => request.command === "tracking_counts"
      )
    ).toMatchObject({
      headOid: RAW_HEAD,
      upstreamOid: RAW_UPSTREAM
    });
    expect(
      requests.filter((request) => request.command === "head_commit")
    ).toHaveLength(2);
    expect(
      requests.filter(
        (request) => request.command === "upstream_commit"
      )
    ).toHaveLength(2);
  });

  it.each([
    { ahead: 0, behind: 0, expected: "in_sync" },
    { ahead: 3, behind: 0, expected: "ahead" },
    { ahead: 0, behind: 4, expected: "behind" },
    { ahead: 2, behind: 5, expected: "diverged" }
  ] as const)("derives $expected from bounded local tracking counts", async ({
    ahead,
    behind,
    expected
  }) => {
    const repositoryPath = await createRepositoryDirectory();
    const snapshot = await collectCodexLocalGitSnapshot({
      installationSecret: INSTALLATION_SECRET,
      scopes: [storedScope("2", repositoryPath)],
      observedAt: OBSERVED_AT,
      runCommand: trackingRunner(repositoryPath, { ahead, behind })
    });
    expect(snapshot.repositories[0]).toMatchObject({
      trackingState: expected,
      aheadCount: ahead,
      behindCount: behind
    });
  });

  it("distinguishes unborn, unconfigured, and unavailable without exposing command output", async () => {
    const repositoryPath = await createRepositoryDirectory();
    const cases = [
      {
        scope: storedScope("3", repositoryPath),
        runner: trackingRunner(repositoryPath, { headExitCode: 1 }),
        state: "unborn",
        reason: null
      },
      {
        scope: storedScope("4", repositoryPath),
        runner: trackingRunner(repositoryPath, {
          upstreamExitCode: 1
        }),
        state: "not_configured",
        reason: null
      },
      {
        scope: storedScope("5", repositoryPath),
        runner: vi.fn(async () => ({
          status: "failed" as const,
          reason: "timeout" as const
        })),
        state: "unavailable",
        reason: "GIT_COMMAND_TIMED_OUT"
      }
    ];
    for (const item of cases) {
      const snapshot = await collectCodexLocalGitSnapshot({
        installationSecret: INSTALLATION_SECRET,
        scopes: [item.scope],
        observedAt: OBSERVED_AT,
        runCommand: item.runner
      });
      expect(snapshot.repositories[0]).toMatchObject({
        trackingState: item.state,
        unavailableReason: item.reason
      });
    }
  });

  it("rejects symlinked scope paths before invoking Git", async () => {
    const repositoryPath = await createRepositoryDirectory();
    const linkPath = join(repositoryPath, "..", "linked-repository");
    await symlink(repositoryPath, linkPath, "dir");
    const runCommand = vi.fn<CodexLocalGitCommandRunner>();

    const snapshot = await collectCodexLocalGitSnapshot({
      installationSecret: INSTALLATION_SECRET,
      scopes: [storedScope("6", linkPath)],
      observedAt: OBSERVED_AT,
      runCommand
    });

    expect(runCommand).not.toHaveBeenCalled();
    expect(snapshot.repositories[0]).toMatchObject({
      repositoryId: null,
      trackingState: "unavailable",
      unavailableReason: "UNSAFE_SCOPE_PATH"
    });
  });

  it("builds production Git execution from a trusted binary and a clean child environment", () => {
    vi.stubEnv("PATH", "/private/poisoned/bin");
    vi.stubEnv("HOME", "/private/poisoned/home");
    vi.stubEnv("GIT_DIR", "/private/other/repository.git");
    vi.stubEnv("GIT_WORK_TREE", "/private/other/worktree");
    vi.stubEnv("GIT_OBJECT_DIRECTORY", "/private/other/objects");
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "remote.origin.url");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "PRIVATE_CREDENTIAL_REMOTE");

    const options = createCodexLocalGitExecFileOptions({
      cwd: "/private/validated/repository",
      timeoutMs: 2_000,
      maxBufferBytes: 32 * 1_024
    });

    expect(CODEX_LOCAL_GIT_EXECUTABLE).toBe("/usr/bin/git");
    expect(options).toMatchObject({
      shell: false,
      timeout: 2_000,
      maxBuffer: 32 * 1_024,
      env: {
        NODE_ENV: "production",
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
    });
    for (const poisonedKey of [
      "PATH",
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0"
    ]) {
      expect(options.env).not.toHaveProperty(poisonedKey);
    }
    expect(
      createCodexLocalGitCommandArguments({
        command: "remote_url",
        configKey: "remote.origin.url",
        cwd: "/private/validated/repository",
        timeoutMs: 2_000,
        maxBufferBytes: 32 * 1_024
      })
    ).toEqual([
      "config",
      "--local",
      "--get-all",
      "remote.origin.url"
    ]);
    expect(
      createCodexLocalGitCommandArguments({
        command: "remote_url",
        configKey: "remote.origin.url=PRIVATE_INJECTION",
        cwd: "/private/validated/repository",
        timeoutMs: 2_000,
        maxBufferBytes: 32 * 1_024
      })
    ).toBeNull();
  });

  it.each([
    { finalHead: "d".repeat(40), finalUpstream: undefined },
    { finalHead: undefined, finalUpstream: "e".repeat(40) }
  ])(
    "fails closed when a tracked ref changes during collection",
    async ({ finalHead, finalUpstream }) => {
      const repositoryPath = await createRepositoryDirectory();
      const runCommand = trackingRunner(repositoryPath, {
        ahead: 1,
        behind: 0,
        finalHead,
        finalUpstream
      });
      const snapshot = await collectCodexLocalGitSnapshot({
        installationSecret: INSTALLATION_SECRET,
        scopes: [storedScope("9", repositoryPath)],
        observedAt: OBSERVED_AT,
        runCommand
      });

      expect(snapshot.repositories[0]).toMatchObject({
        trackingState: "unavailable",
        headCommitId: null,
        aheadCount: null,
        behindCount: null,
        headCommittedAt: null,
        unavailableReason: "GIT_REFS_CHANGED_DURING_COLLECTION"
      });
      const serialized = JSON.stringify(snapshot);
      for (const privateRef of [finalHead, finalUpstream]) {
        if (privateRef !== undefined) {
          expect(serialized).not.toContain(privateRef);
        }
      }
    }
  );

  it("validates deterministic hashes and atomically resets private 0600 storage", async () => {
    const cwd = await createTemporaryDirectory();
    const repositoryPath = await createRepositoryDirectory();
    const scope = storedScope("7", repositoryPath);
    const config = storedConfig(scope);
    await writeStoredCodexConfig(config, cwd);
    const snapshot = await collectCodexLocalGitSnapshot({
      installationSecret: INSTALLATION_SECRET,
      scopes: [scope],
      observedAt: OBSERVED_AT,
      runCommand: trackingRunner(repositoryPath, {
        ahead: 0,
        behind: 0
      })
    });

    await writeStoredCodexLocalGitSnapshot(snapshot, config, cwd);
    await expect(readStoredCodexLocalGitSnapshot(cwd)).resolves.toEqual(
      snapshot
    );
    expect(
      (await stat(join(codexLocalDirectory(cwd), "local-git.json")))
        .mode & 0o777
    ).toBe(0o600);
    expect(() =>
      parseCodexLocalGitSnapshot({
        ...snapshot,
        repositories: []
      })
    ).toThrow();
    const { snapshotSha256: _snapshotSha256, ...content } = snapshot;
    for (const headCommittedAt of [
      "1969-12-31T23:59:59.999Z",
      "2026-08-09T03:05:00.001Z"
    ]) {
      expect(() =>
        sealCodexLocalGitSnapshot({
          ...content,
          repositories: content.repositories.map((repository) => ({
            ...repository,
            headCommittedAt
          }))
        })
      ).toThrow("Local Git commit timestamp is outside bounds.");
    }

    await transitionStoredCodexConfig(
      config,
      { ...config, selectedScopeIds: [] },
      cwd
    );
    await expect(readStoredCodexLocalGitSnapshot(cwd)).resolves.toBeNull();
  });

  it("deletes private Local Git state and rejects a stale post-disconnect write", async () => {
    const cwd = await createTemporaryDirectory();
    const repositoryPath = await createRepositoryDirectory();
    const scope = storedScope("8", repositoryPath);
    const config = storedConfig(scope);
    await writeStoredCodexConfig(config, cwd);
    const snapshot = await collectCodexLocalGitSnapshot({
      installationSecret: INSTALLATION_SECRET,
      scopes: [scope],
      observedAt: OBSERVED_AT,
      runCommand: trackingRunner(repositoryPath, {
        ahead: 0,
        behind: 0
      })
    });
    const generation = codexStoreGeneration(cwd);
    await writeStoredCodexLocalGitSnapshot(
      snapshot,
      config,
      cwd,
      generation
    );

    const firstStore = {
      codexStoreGeneration,
      writeStoredCodexLocalGitSnapshot
    };
    vi.resetModules();
    const secondStore = await import(
      "../src/connectors/codex/localStore"
    );
    expect(secondStore.codexStoreGeneration(join(cwd, "."))).toBe(
      generation
    );

    await secondStore.deleteStoredCodexConnection(join(cwd, "."));

    await expect(readStoredCodexLocalGitSnapshot(cwd)).resolves.toBeNull();
    expect(firstStore.codexStoreGeneration(cwd)).toBe(generation + 1);
    await expect(
      firstStore.writeStoredCodexLocalGitSnapshot(
        snapshot,
        config,
        cwd,
        generation
      )
    ).rejects.toThrow("Codex connector state changed during operation.");
    await expect(
      lstat(join(codexLocalDirectory(cwd), "local-git.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function trackingRunner(
  repositoryPath: string,
  options: {
    ahead?: number;
    behind?: number;
    headExitCode?: number;
    upstreamExitCode?: number;
    rawRemote?: string;
    finalHead?: string;
    finalUpstream?: string;
  }
): CodexLocalGitCommandRunner {
  let headReadCount = 0;
  let upstreamReadCount = 0;
  return vi.fn<CodexLocalGitCommandRunner>(async ({ command }) => {
    switch (command) {
      case "repository_root":
        return exited(repositoryPath);
      case "inside_work_tree":
        return exited("true");
      case "head_commit":
        headReadCount += 1;
        if (headReadCount > 1 && options.finalHead) {
          return exited(options.finalHead);
        }
        return options.headExitCode === 1
          ? exited("", 1)
          : exited(RAW_HEAD);
      case "head_committed_at":
        return exited("2026-08-09T02:00:00+00:00");
      case "remote_names":
        return options.rawRemote
          ? exited("remote.origin.url")
          : exited("", 1);
      case "remote_url":
        return options.rawRemote
          ? exited(options.rawRemote)
          : exited("", 1);
      case "upstream_commit":
        upstreamReadCount += 1;
        if (upstreamReadCount > 1 && options.finalUpstream) {
          return exited(options.finalUpstream);
        }
        return options.upstreamExitCode === 1
          ? exited("", 1)
          : exited(RAW_UPSTREAM);
      case "tracking_counts":
        return exited(`${options.ahead ?? 0}\t${options.behind ?? 0}`);
    }
    const exhaustiveCommand: never = command;
    throw new TypeError(
      `Unexpected Local Git command: ${exhaustiveCommand}`
    );
  });
}

function exited(stdout: string, exitCode = 0) {
  return { status: "exited" as const, exitCode, stdout };
}

function storedScope(
  digit: string,
  queryPath: string
): StoredCodexScope {
  return {
    id: digit.repeat(24),
    queryPath,
    label: "Private project",
    sessionCount: 1,
    lastActivityAt: OBSERVED_AT
  };
}

function storedConfig(scope: StoredCodexScope): StoredCodexConfig {
  return {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: INSTALLATION_SECRET,
    selectedScopeIds: [scope.id],
    scopes: [scope],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: OBSERVED_AT
  };
}

async function createRepositoryDirectory(): Promise<string> {
  const directory = await createTemporaryDirectory();
  const repository = join(directory, "repository");
  await mkdir(repository);
  return realpath(repository);
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "blabase-local-git-"))
  );
  temporaryDirectories.push(directory);
  return directory;
}
