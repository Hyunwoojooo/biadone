import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  continuePromptEpisode,
  DEFAULT_LIMITS,
  DISABLED_REASONS,
  evaluateRollback as evaluateRollbackRaw,
  initializeM0FixtureSafety,
  M0SafetyError,
  planRetention,
  rollbackEpisode as rollbackEpisodeRaw,
  sealEpisodeBoundary as sealEpisodeBoundaryRaw,
  sealPromptBaseline,
} from "../checkpoint/index.mjs";

const execFileAsync = promisify(execFile);
const CLEAN_HAZARDS = Object.freeze({
  ignoredPathChanged: false,
  submoduleChanged: false,
  lfsPathChanged: false,
  outsideRootChanged: false,
  externalSideEffect: false,
});

function sealEpisodeBoundary(options) {
  return sealEpisodeBoundaryRaw({
    ...options,
    hazards: { ...CLEAN_HAZARDS, ...options.hazards },
  });
}

function evaluateRollback(options) {
  return evaluateRollbackRaw({
    ...options,
    hazards: { ...CLEAN_HAZARDS, ...options.hazards },
  });
}

function rollbackEpisode(options) {
  return rollbackEpisodeRaw({
    ...options,
    hazards: { ...CLEAN_HAZARDS, ...options.hazards },
  });
}

async function git(repoRoot, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  return stdout;
}

async function writeFixtureFile(repoRoot, relativePath, content, mode) {
  const absolute = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
  if (mode !== undefined) await chmod(absolute, mode);
}

async function createFixture(t, { files, configure = true } = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "blabee-m0-checkpoint-"));
  const repoRoot = path.join(fixtureRoot, "repo");
  const storageRoot = path.join(fixtureRoot, "store");
  await mkdir(repoRoot);
  await git(repoRoot, "init", "-q");
  if (configure) {
    await git(repoRoot, "config", "user.name", "Blabee Fixture");
    await git(repoRoot, "config", "user.email", "fixture@blabee.invalid");
  }
  for (const [relativePath, value] of Object.entries(files ?? { "tracked.txt": "baseline\n" })) {
    await writeFixtureFile(repoRoot, relativePath, value);
  }
  await git(repoRoot, "add", "-A");
  await git(repoRoot, "commit", "-qm", "fixture baseline");
  const safety = await initializeM0FixtureSafety({ repoRoot });
  t.after(async () => await rm(fixtureRoot, { recursive: true, force: true }));
  return { fixtureRoot, repoRoot, storageRoot, safety };
}

function promptIds(suffix = "1") {
  return {
    projectId: `project-${suffix}`,
    sessionId: `session-${suffix}`,
    episodeId: `episode-${suffix}`,
    episodeRootPromptId: `prompt-root-${suffix}`,
    sourcePromptId: `prompt-source-${suffix}`,
    sourceTurnId: `turn-${suffix}`,
  };
}

async function seal(fixture, { suffix = "1", limits } = {}) {
  return await sealPromptBaseline({
    ...promptIds(suffix),
    repoRoot: fixture.repoRoot,
    storageRoot: fixture.storageRoot,
    safetyToken: fixture.safety.token,
    limits,
  });
}

test("M0 safety refuses non-Git rollback and any repository outside os.tmpdir", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "blabee-m0-nongit-"));
  const nonGit = path.join(fixtureRoot, "plain");
  await mkdir(nonGit);
  t.after(async () => await rm(fixtureRoot, { recursive: true, force: true }));

  const checkpoint = await sealPromptBaseline({
    ...promptIds("nongit"),
    repoRoot: nonGit,
    storageRoot: path.join(fixtureRoot, "store"),
  });
  assert.equal(checkpoint.rollback.enabled, false);
  assert.equal(checkpoint.rollback.disabledReason, DISABLED_REASONS.NOT_A_GIT_REPOSITORY);
  const continuation = continuePromptEpisode({
    checkpoint,
    episodeId: checkpoint.episodeId,
    origin: "pet_action",
    sourcePromptId: "nongit-continuation",
    sourceTurnId: "nongit-turn",
  });
  assert.equal(continuation.episodeId, checkpoint.episodeId);
  assert.equal(continuation.episodeBaselineCheckpointId, null);
  assert.equal((await evaluateRollback({ checkpoint })).disabledReason, DISABLED_REASONS.NOT_A_GIT_REPOSITORY);
  assert.equal((await rollbackEpisode({ checkpoint })).rollback.disabledReason, DISABLED_REASONS.NOT_A_GIT_REPOSITORY);

  await assert.rejects(
    initializeM0FixtureSafety({ repoRoot: process.cwd() }),
    (error) => error instanceof M0SafetyError && error.code === "unsafe_path",
  );
});

test("baseline sealing rejects staged, unstaged, and untracked pre-prompt state", async (t) => {
  for (const kind of ["staged", "unstaged", "untracked"]) {
    await t.test(kind, async (t) => {
      const fixture = await createFixture(t);
      if (kind === "staged") {
        await writeFixtureFile(fixture.repoRoot, "tracked.txt", "staged\n");
        await git(fixture.repoRoot, "add", "tracked.txt");
      } else if (kind === "unstaged") {
        await writeFixtureFile(fixture.repoRoot, "tracked.txt", "unstaged\n");
      } else {
        await writeFixtureFile(fixture.repoRoot, "new.txt", "untracked\n");
      }

      const checkpoint = await seal(fixture, { suffix: kind });
      assert.equal(checkpoint.rollback.enabled, false);
      assert.equal(checkpoint.rollback.disabledReason, DISABLED_REASONS.BASELINE_DIRTY);
    });
  }
});

test("special index flags cannot hide work from the rollback boundary", async (t) => {
  await t.test("assume-unchanged at baseline", async (t) => {
    const fixture = await createFixture(t);
    await git(fixture.repoRoot, "update-index", "--assume-unchanged", "tracked.txt");
    const checkpoint = await seal(fixture, { suffix: "assume-baseline" });
    assert.equal(checkpoint.rollback.enabled, false);
    assert.equal(
      checkpoint.rollback.disabledReason,
      DISABLED_REASONS.UNSUPPORTED_INDEX_STATE,
    );
  });

  await t.test("assume-unchanged after baseline", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, { suffix: "assume-after" });
    await git(fixture.repoRoot, "update-index", "--assume-unchanged", "tracked.txt");
    await writeFixtureFile(fixture.repoRoot, "tracked.txt", "hidden user change\n");
    assert.equal(await git(fixture.repoRoot, "status", "--porcelain=v1"), "");
    const boundary = await sealEpisodeBoundary({
      checkpoint,
      safetyToken: fixture.safety.token,
      ownedPaths: [],
    });
    assert.equal(
      boundary.rollback.disabledReason,
      DISABLED_REASONS.UNSUPPORTED_INDEX_STATE,
    );
  });

  await t.test("skip-worktree and sparse paths", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, { suffix: "skip-worktree" });
    await git(fixture.repoRoot, "update-index", "--skip-worktree", "tracked.txt");
    const boundary = await sealEpisodeBoundary({
      checkpoint,
      safetyToken: fixture.safety.token,
      ownedPaths: [],
    });
    assert.equal(
      boundary.rollback.disabledReason,
      DISABLED_REASONS.UNSUPPORTED_INDEX_STATE,
    );
  });
});

test("non-Git POSIX mode changes disable rollback instead of claiming restoration", async (t) => {
  const fixture = await createFixture(t);
  const checkpoint = await seal(fixture, { suffix: "non-git-mode" });
  assert.equal(checkpoint.rollback.enabled, true);

  await chmod(path.join(fixture.repoRoot, "tracked.txt"), 0o600);
  assert.equal(await git(fixture.repoRoot, "status", "--porcelain=v1"), "");
  const boundary = await sealEpisodeBoundary({
    checkpoint,
    safetyToken: fixture.safety.token,
    ownedPaths: [],
  });
  assert.equal(
    boundary.rollback.disabledReason,
    DISABLED_REASONS.UNSUPPORTED_FILE_METADATA,
  );
  assert.deepEqual(boundary.rollback.paths, ["tracked.txt"]);
});

test("core.filemode=false cannot hide executable-bit changes", async (t) => {
  const fixture = await createFixture(t);
  const checkpoint = await seal(fixture, { suffix: "filemode-false" });
  assert.equal(checkpoint.rollback.enabled, true);

  await git(fixture.repoRoot, "config", "core.filemode", "false");
  await chmod(path.join(fixture.repoRoot, "tracked.txt"), 0o755);
  assert.equal(await git(fixture.repoRoot, "status", "--porcelain=v1"), "");
  const boundary = await sealEpisodeBoundary({
    checkpoint,
    safetyToken: fixture.safety.token,
    ownedPaths: [],
  });
  assert.equal(
    boundary.rollback.disabledReason,
    DISABLED_REASONS.UNSUPPORTED_GIT_CONFIGURATION,
  );
  assert.equal(boundary.rollback.setting, "core.filemode");
});

test("Pet actions and format repair retain one human-prompt baseline", async (t) => {
  const fixture = await createFixture(t);
  const checkpoint = await seal(fixture);
  assert.equal(checkpoint.rollback.enabled, true);

  for (const origin of ["pet_action", "internal_format_repair"]) {
    const continuation = continuePromptEpisode({
      checkpoint,
      episodeId: checkpoint.episodeId,
      origin,
      sourcePromptId: `${origin}-prompt`,
      sourceTurnId: `${origin}-turn`,
    });
    assert.equal(continuation.episodeId, checkpoint.episodeId);
    assert.equal(continuation.episodeRootPromptId, checkpoint.episodeRootPromptId);
    assert.equal(continuation.episodeBaselineCheckpointId, checkpoint.checkpointId);
  }
});

test("rollback restores tracked, staged, untracked, binary, rename, mode, deletion, and symlink state", async (t) => {
  const fixture = await createFixture(t, {
    files: {
      "tracked.txt": "baseline text\n",
      "script.sh": "#!/bin/sh\necho baseline\n",
      "binary.bin": Buffer.from([0x00, 0x01, 0xfe, 0xff]),
      "rename-me.txt": "original name\n",
      "delete-me.txt": "do not lose me\n",
    },
  });
  await chmod(path.join(fixture.repoRoot, "script.sh"), 0o755);
  await symlink("tracked.txt", path.join(fixture.repoRoot, "link"));
  await git(fixture.repoRoot, "add", "script.sh", "link");
  await git(fixture.repoRoot, "commit", "-qm", "add mode and symlink baseline");

  const checkpoint = await seal(fixture, { suffix: "restore" });
  assert.equal(checkpoint.rollback.enabled, true);

  await writeFixtureFile(fixture.repoRoot, "tracked.txt", "staged text\n");
  await chmod(path.join(fixture.repoRoot, "script.sh"), 0o644);
  await writeFixtureFile(fixture.repoRoot, "binary.bin", Buffer.from([0xaa, 0xbb, 0xcc]));
  await rename(path.join(fixture.repoRoot, "rename-me.txt"), path.join(fixture.repoRoot, "renamed.txt"));
  await unlink(path.join(fixture.repoRoot, "delete-me.txt"));
  await unlink(path.join(fixture.repoRoot, "link"));
  await symlink("script.sh", path.join(fixture.repoRoot, "link"));
  await git(fixture.repoRoot, "add", "-A");
  await writeFixtureFile(fixture.repoRoot, "tracked.txt", "unstaged after staged text\n");
  await writeFixtureFile(fixture.repoRoot, "nested/untracked.txt", "remove me\n");

  const ownedPaths = [
    "binary.bin",
    "delete-me.txt",
    "link",
    "nested/untracked.txt",
    "rename-me.txt",
    "renamed.txt",
    "script.sh",
    "tracked.txt",
  ];
  const boundary = await sealEpisodeBoundary({
    checkpoint,
    safetyToken: fixture.safety.token,
    ownedPaths,
  });
  assert.equal(boundary.rollback.enabled, true, JSON.stringify(boundary.rollback));
  assert.equal((await evaluateRollback({ checkpoint, boundary, safetyToken: fixture.safety.token })).enabled, true);

  const result = await rollbackEpisode({ checkpoint, boundary, safetyToken: fixture.safety.token });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(await git(fixture.repoRoot, "status", "--porcelain=v1"), "");
  assert.equal(await readFile(path.join(fixture.repoRoot, "tracked.txt"), "utf8"), "baseline text\n");
  assert.deepEqual(await readFile(path.join(fixture.repoRoot, "binary.bin")), Buffer.from([0x00, 0x01, 0xfe, 0xff]));
  assert.equal((await lstat(path.join(fixture.repoRoot, "script.sh"))).mode & 0o111, 0o111);
  assert.equal(await readlink(path.join(fixture.repoRoot, "link")), "tracked.txt");
  assert.equal(await readFile(path.join(fixture.repoRoot, "rename-me.txt"), "utf8"), "original name\n");
  assert.equal(await readFile(path.join(fixture.repoRoot, "delete-me.txt"), "utf8"), "do not lose me\n");
  await assert.rejects(readFile(path.join(fixture.repoRoot, "renamed.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(fixture.repoRoot, "nested/untracked.txt")), { code: "ENOENT" });
  assert.equal(await git(fixture.repoRoot, "diff", "--cached", "--name-only"), "");
  assert.equal((await readFile(path.join(result.recoverySnapshotPath, "manifest.json"), "utf8")).includes(checkpoint.episodeId), true);
  assert.equal((await lstat(path.join(result.recoverySnapshotPath, "index"))).isFile(), true);
});

test("branch or HEAD changes disable rollback", async (t) => {
  await t.test("branch", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, { suffix: "branch" });
    await git(fixture.repoRoot, "switch", "-qc", "other-branch");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: [] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.HEAD_CHANGED);
  });

  await t.test("HEAD", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, { suffix: "head" });
    await writeFixtureFile(fixture.repoRoot, "committed.txt", "new HEAD\n");
    await git(fixture.repoRoot, "add", "committed.txt");
    await git(fixture.repoRoot, "commit", "-qm", "move head");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["committed.txt"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.HEAD_CHANGED);
  });
});

test("unowned paths and edits after a sealed boundary are treated as concurrent", async (t) => {
  await t.test("unowned path", async (t) => {
    const fixture = await createFixture(t, { files: { "owned.txt": "one\n", "other.txt": "two\n" } });
    const checkpoint = await seal(fixture, { suffix: "unowned" });
    await writeFixtureFile(fixture.repoRoot, "owned.txt", "changed\n");
    await writeFixtureFile(fixture.repoRoot, "other.txt", "also changed\n");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["owned.txt"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.CONCURRENT_EDIT);
    assert.deepEqual(boundary.rollback.unownedPaths, ["other.txt"]);
  });

  await t.test("post-boundary edit", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, { suffix: "concurrent" });
    await writeFixtureFile(fixture.repoRoot, "tracked.txt", "episode change\n");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["tracked.txt"] });
    assert.equal(boundary.rollback.enabled, true);
    await writeFixtureFile(fixture.repoRoot, "tracked.txt", "outside writer\n");
    const evaluation = await evaluateRollback({ checkpoint, boundary, safetyToken: fixture.safety.token });
    assert.equal(evaluation.disabledReason, DISABLED_REASONS.CONCURRENT_EDIT);
  });
});

test("excluded paths and explicit external effect attestations disable rollback", async (t) => {
  await t.test("missing hazard attestation fails closed", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, { suffix: "unknown-hazards" });
    const boundary = await sealEpisodeBoundaryRaw({
      checkpoint,
      safetyToken: fixture.safety.token,
      ownedPaths: [],
    });
    assert.equal(
      boundary.rollback.disabledReason,
      DISABLED_REASONS.HAZARD_ATTESTATION_MISSING,
    );
    assert.deepEqual(boundary.rollback.unknownHazards, [
      "ignoredPathChanged",
      "submoduleChanged",
      "lfsPathChanged",
      "outsideRootChanged",
      "externalSideEffect",
    ]);
  });

  await t.test("ignored path is detected from repository state", async (t) => {
    const fixture = await createFixture(t, { files: { ".gitignore": "ignored.log\n", "tracked.txt": "base\n" } });
    await writeFixtureFile(fixture.repoRoot, "ignored.log", "baseline ignored\n");
    const checkpoint = await seal(fixture, { suffix: "ignored" });
    await writeFixtureFile(fixture.repoRoot, "ignored.log", "changed ignored\n");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: [] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.EXCLUDED_PATH_CHANGED);
  });

  await t.test("LFS attribute is detected without requiring Git LFS", async (t) => {
    const fixture = await createFixture(t, {
      files: { ".gitattributes": "*.lfs filter=lfs\n", "asset.lfs": "pointer baseline\n" },
    });
    const checkpoint = await seal(fixture, { suffix: "lfs" });
    await writeFixtureFile(fixture.repoRoot, "asset.lfs", "changed lfs worktree\n");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["asset.lfs"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.EXCLUDED_PATH_CHANGED);
  });

  const hazardCases = [
    ["ignoredPathChanged", DISABLED_REASONS.EXCLUDED_PATH_CHANGED],
    ["submoduleChanged", DISABLED_REASONS.EXCLUDED_PATH_CHANGED],
    ["lfsPathChanged", DISABLED_REASONS.EXCLUDED_PATH_CHANGED],
    ["outsideRootChanged", DISABLED_REASONS.EXCLUDED_PATH_CHANGED],
    ["externalSideEffect", DISABLED_REASONS.EXTERNAL_SIDE_EFFECT],
  ];
  for (const [hazard, reason] of hazardCases) {
    await t.test(hazard, async (t) => {
      const fixture = await createFixture(t);
      const checkpoint = await seal(fixture, { suffix: hazard });
      const boundary = await sealEpisodeBoundary({
        checkpoint,
        safetyToken: fixture.safety.token,
        ownedPaths: [],
        hazards: { [hazard]: true },
      });
      assert.equal(boundary.rollback.disabledReason, reason);
    });
  }
});

test("submodule checkout changes are detected as excluded", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "blabee-m0-submodule-"));
  const childRoot = path.join(fixtureRoot, "child");
  const repoRoot = path.join(fixtureRoot, "repo");
  const storageRoot = path.join(fixtureRoot, "store");
  await mkdir(childRoot);
  await mkdir(repoRoot);
  for (const root of [childRoot, repoRoot]) {
    await git(root, "init", "-q");
    await git(root, "config", "user.name", "Blabee Fixture");
    await git(root, "config", "user.email", "fixture@blabee.invalid");
  }
  await writeFixtureFile(childRoot, "child.txt", "child baseline\n");
  await git(childRoot, "add", "child.txt");
  await git(childRoot, "commit", "-qm", "child baseline");
  await writeFixtureFile(repoRoot, "root.txt", "root baseline\n");
  await git(repoRoot, "add", "root.txt");
  await git(repoRoot, "commit", "-qm", "root baseline");
  await git(repoRoot, "-c", "protocol.file.allow=always", "submodule", "add", "-q", childRoot, "vendor/child");
  await git(repoRoot, "commit", "-qam", "add submodule");
  const safety = await initializeM0FixtureSafety({ repoRoot });
  t.after(async () => await rm(fixtureRoot, { recursive: true, force: true }));

  const checkpoint = await sealPromptBaseline({
    ...promptIds("submodule-real"),
    repoRoot,
    storageRoot,
    safetyToken: safety.token,
  });
  await writeFixtureFile(path.join(repoRoot, "vendor/child"), "child.txt", "changed child\n");
  const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: safety.token, ownedPaths: ["vendor/child"] });
  assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.EXCLUDED_PATH_CHANGED);
});

test("file, checkpoint, and project retention limits disable rollback", async (t) => {
  assert.deepEqual(DEFAULT_LIMITS, {
    fileBytes: 16 * 1024 * 1024,
    checkpointBytes: 128 * 1024 * 1024,
    projectBytes: 1024 * 1024 * 1024,
  });

  await t.test("file limit", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, {
      suffix: "file-limit",
      limits: { fileBytes: 8, checkpointBytes: 20_000, projectBytes: 100_000 },
    });
    await writeFixtureFile(fixture.repoRoot, "tracked.txt", "this is larger than eight bytes\n");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["tracked.txt"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.SIZE_LIMIT_EXCEEDED);
    assert.equal(boundary.rollback.scope, "file");
  });

  await t.test("file limit also covers a staged deletion's baseline blob", async (t) => {
    const fixture = await createFixture(t, { files: { "large.txt": "x".repeat(32) } });
    const checkpoint = await seal(fixture, {
      suffix: "deleted-file-limit",
      limits: { fileBytes: 8, checkpointBytes: 20_000, projectBytes: 100_000 },
    });
    await unlink(path.join(fixture.repoRoot, "large.txt"));
    await git(fixture.repoRoot, "add", "-A");
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["large.txt"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.SIZE_LIMIT_EXCEEDED);
    assert.equal(boundary.rollback.scope, "file");
  });

  await t.test("checkpoint limit", async (t) => {
    const fixture = await createFixture(t, { files: { "a.txt": "a\n", "b.txt": "b\n" } });
    const checkpoint = await seal(fixture, {
      suffix: "checkpoint-limit",
      limits: { fileBytes: 7_000, checkpointBytes: 10_000, projectBytes: 100_000 },
    });
    await writeFixtureFile(fixture.repoRoot, "a.txt", "a".repeat(6_000));
    await writeFixtureFile(fixture.repoRoot, "b.txt", "b".repeat(6_000));
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["a.txt", "b.txt"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.SIZE_LIMIT_EXCEEDED);
    assert.equal(boundary.rollback.scope, "checkpoint");
  });

  await t.test("project capacity", async (t) => {
    const fixture = await createFixture(t);
    const checkpoint = await seal(fixture, {
      suffix: "project-limit",
      limits: { fileBytes: 20_000, checkpointBytes: 20_000, projectBytes: 6_000 },
    });
    assert.equal(checkpoint.rollback.enabled, true, JSON.stringify(checkpoint.rollback));
    await writeFixtureFile(fixture.repoRoot, "tracked.txt", "x".repeat(10_000));
    const boundary = await sealEpisodeBoundary({ checkpoint, safetyToken: fixture.safety.token, ownedPaths: ["tracked.txt"] });
    assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.RETENTION_CAPACITY_EXHAUSTED);
  });
});

test("retention evicts ended episodes oldest-first and protects active, paused, pending, and latest recovery", () => {
  const records = [
    { id: "ended-old", projectId: "p", kind: "baseline", status: "ended", pendingRef: false, bytes: 10, createdAt: "2026-01-01T00:00:00Z" },
    { id: "ended-new", projectId: "p", kind: "baseline", status: "ended", pendingRef: false, bytes: 10, createdAt: "2026-01-02T00:00:00Z" },
    { id: "active", projectId: "p", kind: "baseline", status: "active", pendingRef: false, bytes: 10, createdAt: "2026-01-03T00:00:00Z" },
    { id: "paused", projectId: "p", kind: "baseline", status: "paused", pendingRef: false, bytes: 10, createdAt: "2026-01-04T00:00:00Z" },
    { id: "pending", projectId: "p", kind: "baseline", status: "ended", pendingRef: true, bytes: 10, createdAt: "2026-01-05T00:00:00Z" },
    { id: "recovery-old", projectId: "p", kind: "recovery", status: "ended", pendingRef: false, bytes: 10, createdAt: "2026-01-06T00:00:00Z" },
    { id: "recovery-latest", projectId: "p", kind: "recovery", status: "ended", pendingRef: false, bytes: 10, createdAt: "2026-01-07T00:00:00Z" },
  ];
  const plan = planRetention(records, { projectId: "p", maxBytes: 55, incomingBytes: 5 });
  assert.deepEqual(plan.removeIds, ["ended-old", "ended-new"]);
  assert.equal(plan.exhausted, false);
  assert.deepEqual(plan.protectedIds, ["active", "paused", "pending", "recovery-latest"]);

  const exhausted = planRetention(records.filter((record) => plan.protectedIds.includes(record.id)), {
    projectId: "p",
    maxBytes: 5,
    incomingBytes: 1,
  });
  assert.equal(exhausted.exhausted, true);
  assert.deepEqual(exhausted.removeIds, []);
});

test("owned path escape is rejected before rollback can be armed", async (t) => {
  const fixture = await createFixture(t);
  const checkpoint = await seal(fixture, { suffix: "escape" });
  await writeFixtureFile(fixture.repoRoot, "tracked.txt", "changed\n");
  const boundary = await sealEpisodeBoundary({
    checkpoint,
    safetyToken: fixture.safety.token,
    ownedPaths: ["../outside"],
  });
  assert.equal(boundary.rollback.disabledReason, DISABLED_REASONS.UNSAFE_PATH);
});
