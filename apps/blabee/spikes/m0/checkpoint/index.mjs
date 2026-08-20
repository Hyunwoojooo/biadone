import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  calculateBoundaryBytes,
  captureRepositoryState,
  excludedStateDigest,
  isClean,
  repositoryIdentity,
  resolveGitDir,
  resolveGitRepository,
  runGit,
} from "./git-state.mjs";
import {
  loadCatalog,
  planRetention,
  reserveRetention,
  saveCatalog,
} from "./retention.mjs";
import {
  assertNoSymlinkParents,
  assertTemporaryRoot,
  isPathOwned,
  M0SafetyError,
  normalizeRepoRelative,
  prepareTemporaryStorage,
  resolveRepoPath,
} from "./safety.mjs";

export { planRetention } from "./retention.mjs";
export { M0SafetyError } from "./safety.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  fileBytes: 16 * 1024 * 1024,
  checkpointBytes: 128 * 1024 * 1024,
  projectBytes: 1024 * 1024 * 1024,
});

export const DISABLED_REASONS = Object.freeze({
  NOT_A_GIT_REPOSITORY: "not_a_git_repository",
  BASELINE_DIRTY: "baseline_dirty",
  CHECKPOINT_PARTIAL: "checkpoint_partial",
  CONCURRENT_EDIT: "concurrent_edit",
  HEAD_CHANGED: "head_changed",
  EXCLUDED_PATH_CHANGED: "excluded_path_changed",
  EXTERNAL_SIDE_EFFECT: "external_side_effect",
  SIZE_LIMIT_EXCEEDED: "size_limit_exceeded",
  RETENTION_CAPACITY_EXHAUSTED: "retention_capacity_exhausted",
  UNSUPPORTED_INDEX_STATE: "unsupported_index_state",
  UNSUPPORTED_FILE_METADATA: "unsupported_file_metadata",
  UNSUPPORTED_GIT_CONFIGURATION: "unsupported_git_configuration",
  HAZARD_ATTESTATION_MISSING: "hazard_attestation_missing",
  UNSAFE_PATH: "unsafe_path",
});

const MARKER_NAME = "blabee-m0-fixture.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function disabled(reason, details = {}) {
  return { enabled: false, disabledReason: reason, ...details };
}

function enabled(details = {}) {
  return { enabled: true, disabledReason: null, ...details };
}

function validateLimits(input = {}) {
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`);
    }
  }
  return Object.freeze(limits);
}

function normalizedHazards(input = {}) {
  const value = (key) => (input[key] === true ? true : input[key] === false ? false : null);
  return {
    ignoredPathChanged: value("ignoredPathChanged"),
    submoduleChanged: value("submoduleChanged"),
    lfsPathChanged: value("lfsPathChanged"),
    outsideRootChanged: value("outsideRootChanged"),
    externalSideEffect: value("externalSideEffect"),
  };
}

function mergeHazards(left = {}, right = {}) {
  const leftNormalized = normalizedHazards(left);
  const rightNormalized = normalizedHazards(right);
  return Object.fromEntries(
    Object.keys(leftNormalized).map((key) => {
      const values = [leftNormalized[key], rightNormalized[key]];
      if (values.includes(true)) return [key, true];
      if (values.includes(null)) return [key, null];
      return [key, false];
    }),
  );
}

function hazardEligibility(hazards) {
  if (hazards.externalSideEffect) return disabled(DISABLED_REASONS.EXTERNAL_SIDE_EFFECT);
  if (
    hazards.ignoredPathChanged ||
    hazards.submoduleChanged ||
    hazards.lfsPathChanged ||
    hazards.outsideRootChanged
  ) {
    return disabled(DISABLED_REASONS.EXCLUDED_PATH_CHANGED);
  }
  const unknownHazards = Object.entries(hazards)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (unknownHazards.length > 0) {
    return disabled(DISABLED_REASONS.HAZARD_ATTESTATION_MISSING, {
      unknownHazards,
    });
  }
  return enabled();
}

function ids(input) {
  const required = ["projectId", "sessionId", "episodeId", "episodeRootPromptId", "sourcePromptId", "sourceTurnId"];
  for (const key of required) {
    if (typeof input[key] !== "string" || input[key].length === 0) {
      throw new TypeError(`${key} is required`);
    }
  }
  return Object.fromEntries(required.map((key) => [key, input[key]]));
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function initializeM0FixtureSafety({ repoRoot }) {
  const resolvedRepo = await resolveGitRepository(repoRoot);
  if (!resolvedRepo) {
    throw new M0SafetyError("M0 fixture authorization requires an exact Git repository root");
  }
  const gitDir = await resolveGitDir(resolvedRepo);
  if (!isInside(resolvedRepo, gitDir)) {
    throw new M0SafetyError("M0 fixture requires a repository-local Git directory");
  }

  const token = randomUUID();
  const marker = { version: 1, repoRoot: resolvedRepo, token };
  await writeFile(path.join(gitDir, MARKER_NAME), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  return Object.freeze({ repoRoot: resolvedRepo, token });
}

async function assertFixtureAuthorization(repoRoot, safetyToken) {
  const resolvedRepo = await resolveGitRepository(repoRoot);
  if (!resolvedRepo) throw new M0SafetyError("M0 mutation requires an exact Git repository root");
  if (typeof safetyToken !== "string" || safetyToken.length === 0) {
    throw new M0SafetyError("M0 fixture safety token is required");
  }

  const gitDir = await resolveGitDir(resolvedRepo);
  if (!isInside(resolvedRepo, gitDir)) {
    throw new M0SafetyError("M0 fixture requires a repository-local Git directory");
  }
  const marker = JSON.parse(await readFile(path.join(gitDir, MARKER_NAME), "utf8"));
  if (marker.repoRoot !== resolvedRepo || marker.token !== safetyToken) {
    throw new M0SafetyError("M0 fixture safety token does not match the repository marker");
  }
  return resolvedRepo;
}

async function persistBaseline(checkpoint, storageRoot, limits) {
  const records = await loadCatalog(storageRoot);
  const serialized = Buffer.from(`${JSON.stringify({ version: 1, checkpoint }, null, 2)}\n`, "utf8");
  if (serialized.length > limits.checkpointBytes) {
    return disabled(DISABLED_REASONS.SIZE_LIMIT_EXCEEDED, { scope: "checkpoint" });
  }

  const reservation = await reserveRetention(storageRoot, records, {
    projectId: checkpoint.projectId,
    maxBytes: limits.projectBytes,
    incomingBytes: serialized.length,
  });
  if (!reservation.ok) return disabled(DISABLED_REASONS.RETENTION_CAPACITY_EXHAUSTED);

  await mkdir(path.join(storageRoot, "records"), { recursive: true, mode: 0o700 });
  const recordDirectory = path.join(storageRoot, "records", checkpoint.checkpointId);
  await mkdir(recordDirectory, { recursive: false, mode: 0o700 });
  await writeFile(path.join(recordDirectory, "baseline.json"), serialized, { mode: 0o600 });
  const record = {
    id: checkpoint.checkpointId,
    projectId: checkpoint.projectId,
    episodeId: checkpoint.episodeId,
    kind: "baseline",
    status: "active",
    pendingRef: false,
    bytes: serialized.length,
    createdAt: checkpoint.createdAt,
  };
  await saveCatalog(storageRoot, [...reservation.records, record]);
  return enabled({ bytes: serialized.length });
}

function disabledCheckpoint(input, repoRoot, storageRoot, limits, reason, details = {}) {
  const inputIds = ids(input);
  return Object.freeze({
    version: 1,
    checkpointId: null,
    episodeBaselineCheckpointId: null,
    ...inputIds,
    repoRoot,
    storageRoot,
    createdAt: new Date().toISOString(),
    limits,
    baselineState: null,
    rollback: disabled(reason, details),
  });
}

export async function sealPromptBaseline(input) {
  const limits = validateLimits(input.limits);
  const repoRoot = await assertTemporaryRoot(input.repoRoot, "repoRoot");
  const discovered = await resolveGitRepository(repoRoot);
  if (!discovered) {
    return disabledCheckpoint(input, repoRoot, null, limits, DISABLED_REASONS.NOT_A_GIT_REPOSITORY);
  }

  const authorizedRepo = await assertFixtureAuthorization(discovered, input.safetyToken);
  const storageRoot = await prepareTemporaryStorage(input.storageRoot, authorizedRepo);
  if (!(await isClean(authorizedRepo))) {
    return disabledCheckpoint(input, authorizedRepo, storageRoot, limits, DISABLED_REASONS.BASELINE_DIRTY);
  }

  const identity = await repositoryIdentity(authorizedRepo);
  if (!identity) {
    return disabledCheckpoint(input, authorizedRepo, storageRoot, limits, DISABLED_REASONS.CHECKPOINT_PARTIAL);
  }

  let baselineState;
  try {
    baselineState = await captureRepositoryState(authorizedRepo);
  } catch (error) {
    if (error instanceof M0SafetyError) {
      return disabledCheckpoint(input, authorizedRepo, storageRoot, limits, DISABLED_REASONS.UNSAFE_PATH);
    }
    throw error;
  }
  if (baselineState.unsupportedIndexFlags.length > 0) {
    return disabledCheckpoint(
      input,
      authorizedRepo,
      storageRoot,
      limits,
      DISABLED_REASONS.UNSUPPORTED_INDEX_STATE,
      { entries: baselineState.unsupportedIndexFlags },
    );
  }
  if (baselineState.capabilities.coreFileMode !== true) {
    return disabledCheckpoint(
      input,
      authorizedRepo,
      storageRoot,
      limits,
      DISABLED_REASONS.UNSUPPORTED_GIT_CONFIGURATION,
      { setting: "core.filemode" },
    );
  }
  const checkpointId = `baseline-${randomUUID()}`;
  const checkpoint = {
    version: 1,
    checkpointId,
    episodeBaselineCheckpointId: checkpointId,
    ...ids(input),
    repoRoot: authorizedRepo,
    storageRoot,
    createdAt: new Date().toISOString(),
    limits,
    baselineState,
    rollback: enabled(),
  };

  const persistence = await persistBaseline(checkpoint, storageRoot, limits);
  if (!persistence.enabled) checkpoint.rollback = persistence;
  return Object.freeze(checkpoint);
}

export function continuePromptEpisode({ checkpoint, episodeId, origin, sourcePromptId, sourceTurnId }) {
  if (!checkpoint?.rollback || typeof checkpoint.episodeId !== "string") throw new TypeError("a prompt episode is required");
  if (episodeId !== checkpoint.episodeId) throw new Error("continuation episode mismatch");
  if (origin !== "pet_action" && origin !== "internal_format_repair") {
    throw new Error("continuation origin must be pet_action or internal_format_repair");
  }
  if (!sourcePromptId || !sourceTurnId) throw new TypeError("continuation source prompt and turn are required");

  return Object.freeze({
    episodeId: checkpoint.episodeId,
    episodeRootPromptId: checkpoint.episodeRootPromptId,
    episodeBaselineCheckpointId: checkpoint.episodeBaselineCheckpointId,
    sourcePromptId,
    sourceTurnId,
    origin,
  });
}

function stateEligibility(checkpoint, state, hazards) {
  if (state.head !== checkpoint.baselineState.head || state.branch !== checkpoint.baselineState.branch) {
    return disabled(DISABLED_REASONS.HEAD_CHANGED);
  }
  if (state.unsupportedIndexFlags.length > 0) {
    return disabled(DISABLED_REASONS.UNSUPPORTED_INDEX_STATE, {
      entries: state.unsupportedIndexFlags,
    });
  }
  if (state.capabilities.coreFileMode !== true) {
    return disabled(DISABLED_REASONS.UNSUPPORTED_GIT_CONFIGURATION, {
      setting: "core.filemode",
    });
  }
  const currentMetadata = new Map(state.trackedMetadata.map((entry) => [entry.path, entry]));
  const unsupportedMetadataPaths = checkpoint.baselineState.trackedMetadata
    .filter((baseline) => {
      const current = currentMetadata.get(baseline.path);
      return (
        baseline.kind === "file" &&
        current?.kind === "file" &&
        baseline.nonGitMode !== current.nonGitMode
      );
    })
    .map((entry) => entry.path);
  if (unsupportedMetadataPaths.length > 0) {
    return disabled(DISABLED_REASONS.UNSUPPORTED_FILE_METADATA, {
      paths: unsupportedMetadataPaths,
    });
  }
  const hazard = hazardEligibility(hazards);
  if (!hazard.enabled) return hazard;
  if (excludedStateDigest(state) !== excludedStateDigest(checkpoint.baselineState)) {
    return disabled(DISABLED_REASONS.EXCLUDED_PATH_CHANGED);
  }
  return enabled();
}

function sizeEligibility(size, limits) {
  const oversized = size.files.find((item) => item.bytes > limits.fileBytes);
  if (oversized) {
    return disabled(DISABLED_REASONS.SIZE_LIMIT_EXCEEDED, {
      scope: "file",
      path: oversized.path,
      bytes: oversized.bytes,
    });
  }
  if (size.totalBytes > limits.checkpointBytes) {
    return disabled(DISABLED_REASONS.SIZE_LIMIT_EXCEEDED, { scope: "checkpoint", bytes: size.totalBytes });
  }
  return enabled();
}

function normalizeOwnedPaths(ownedPaths) {
  if (!Array.isArray(ownedPaths)) throw new TypeError("ownedPaths must be an array");
  return [...new Set(ownedPaths.map((scope) => {
    if (typeof scope !== "string") throw new M0SafetyError("owned path scopes must be strings");
    if (scope.endsWith("/**")) return `${normalizeRepoRelative(scope.slice(0, -3))}/**`;
    if (scope.endsWith("/")) return `${normalizeRepoRelative(scope.slice(0, -1))}/`;
    return normalizeRepoRelative(scope);
  }))].sort();
}

export async function sealEpisodeBoundary({ checkpoint, safetyToken, ownedPaths, hazards: inputHazards = {} }) {
  if (!checkpoint?.rollback?.enabled) {
    return Object.freeze({ checkpointId: checkpoint?.checkpointId ?? null, rollback: checkpoint?.rollback ?? disabled(DISABLED_REASONS.CHECKPOINT_PARTIAL) });
  }

  let normalizedOwned;
  try {
    normalizedOwned = normalizeOwnedPaths(ownedPaths);
  } catch (error) {
    if (error instanceof M0SafetyError) {
      return Object.freeze({ checkpointId: checkpoint.checkpointId, rollback: disabled(DISABLED_REASONS.UNSAFE_PATH) });
    }
    throw error;
  }

  await assertFixtureAuthorization(checkpoint.repoRoot, safetyToken);
  let state;
  try {
    state = await captureRepositoryState(checkpoint.repoRoot);
  } catch (error) {
    if (error instanceof M0SafetyError) {
      return Object.freeze({ checkpointId: checkpoint.checkpointId, rollback: disabled(DISABLED_REASONS.UNSAFE_PATH) });
    }
    throw error;
  }
  let rollback = stateEligibility(checkpoint, state, normalizedHazards(inputHazards));

  const unownedPaths = state.status.changedPaths.filter((changedPath) => !isPathOwned(changedPath, normalizedOwned));
  if (rollback.enabled && unownedPaths.length > 0) {
    rollback = disabled(DISABLED_REASONS.CONCURRENT_EDIT, { unownedPaths });
  }

  let size = null;
  if (rollback.enabled) {
    size = await calculateBoundaryBytes(checkpoint.repoRoot, state, checkpoint.baselineState);
    rollback = sizeEligibility(size, checkpoint.limits);
  }
  if (rollback.enabled) {
    const records = await loadCatalog(checkpoint.storageRoot);
    const plan = planRetention(records, {
      projectId: checkpoint.projectId,
      maxBytes: checkpoint.limits.projectBytes,
      incomingBytes: size.totalBytes,
    });
    if (plan.exhausted) rollback = disabled(DISABLED_REASONS.RETENTION_CAPACITY_EXHAUSTED);
  }

  return Object.freeze({
    version: 1,
    boundaryId: `boundary-${randomUUID()}`,
    checkpointId: checkpoint.checkpointId,
    episodeId: checkpoint.episodeId,
    episodeBaselineCheckpointId: checkpoint.episodeBaselineCheckpointId,
    sealedAt: new Date().toISOString(),
    ownedPaths: normalizedOwned,
    hazards: normalizedHazards(inputHazards),
    state,
    size,
    rollback,
  });
}

async function evaluateState({ checkpoint, boundary, hazards }, state) {
  if (!checkpoint?.rollback?.enabled) return checkpoint?.rollback ?? disabled(DISABLED_REASONS.CHECKPOINT_PARTIAL);
  if (!boundary || boundary.checkpointId !== checkpoint.checkpointId || boundary.episodeId !== checkpoint.episodeId) {
    return disabled(DISABLED_REASONS.CHECKPOINT_PARTIAL);
  }
  if (!boundary.rollback.enabled) return boundary.rollback;

  const mergedHazards = mergeHazards(boundary.hazards, hazards);
  const stateCheck = stateEligibility(checkpoint, state, mergedHazards);
  if (!stateCheck.enabled) return stateCheck;
  if (state.digest !== boundary.state.digest) return disabled(DISABLED_REASONS.CONCURRENT_EDIT);
  return enabled();
}

export async function evaluateRollback({ checkpoint, boundary, safetyToken, hazards = {} }) {
  if (!checkpoint?.rollback?.enabled) {
    return checkpoint?.rollback ?? disabled(DISABLED_REASONS.NOT_A_GIT_REPOSITORY);
  }
  if (!checkpoint?.repoRoot) return checkpoint?.rollback ?? disabled(DISABLED_REASONS.NOT_A_GIT_REPOSITORY);
  await assertFixtureAuthorization(checkpoint.repoRoot, safetyToken);
  const state = await captureRepositoryState(checkpoint.repoRoot);
  return await evaluateState({ checkpoint, boundary, hazards }, state);
}

async function acquireProjectLock(storageRoot, projectId) {
  const lockName = `${sha256(Buffer.from(projectId, "utf8"))}.lock`;
  const lockPath = path.join(storageRoot, lockName);
  const handle = await open(lockPath, "wx", 0o600);
  return async () => {
    await handle.close();
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  };
}

async function createRecoverySnapshot(checkpoint, boundary, state, catalog) {
  const recoveryId = `recovery-${randomUUID()}`;
  const recordDirectory = path.join(checkpoint.storageRoot, "records", recoveryId);
  const temporaryDirectory = `${recordDirectory}.tmp`;
  let manifest;
  try {
    await mkdir(path.join(temporaryDirectory, "blobs"), { recursive: true, mode: 0o700 });

    const manifestEntries = [];
    for (const entry of state.entries) {
      const manifestEntry = { ...entry };
      if (entry.kind === "file") {
        const { absolute } = resolveRepoPath(checkpoint.repoRoot, entry.path);
        await assertNoSymlinkParents(checkpoint.repoRoot, entry.path);
        const blobPath = path.join(temporaryDirectory, "blobs", entry.digest);
        await copyFile(absolute, blobPath);
        const copied = await readFile(blobPath);
        if (sha256(copied) !== entry.digest) throw new Error(`concurrent edit while snapshotting ${entry.path}`);
        manifestEntry.blob = `blobs/${entry.digest}`;
      }
      manifestEntries.push(manifestEntry);
    }

    const currentGitDir = await resolveGitDir(checkpoint.repoRoot);
    await copyFile(path.join(currentGitDir, "index"), path.join(temporaryDirectory, "index"));
    manifest = {
      version: 1,
      recoveryId,
      checkpointId: checkpoint.checkpointId,
      episodeId: checkpoint.episodeId,
      createdAt: new Date().toISOString(),
      repoRoot: checkpoint.repoRoot,
      head: state.head,
      branch: state.branch,
      indexEntries: state.indexEntries,
      entries: manifestEntries,
    };
    await writeFile(path.join(temporaryDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryDirectory, recordDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  const record = {
    id: recoveryId,
    projectId: checkpoint.projectId,
    episodeId: checkpoint.episodeId,
    kind: "recovery",
    status: "ended",
    pendingRef: false,
    bytes: boundary.size.totalBytes,
    createdAt: manifest.createdAt,
  };
  await saveCatalog(checkpoint.storageRoot, [...catalog, record]);
  return { recoveryId, path: recordDirectory, record };
}

async function removeUntracked(repoRoot, untrackedPaths) {
  const parents = new Set();
  for (const relativePath of [...untrackedPaths].sort((left, right) => right.length - left.length)) {
    await assertNoSymlinkParents(repoRoot, relativePath);
    const { absolute } = resolveRepoPath(repoRoot, relativePath);
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await rmdir(absolute).catch((error) => {
        if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error;
      });
    } else {
      await unlink(absolute);
    }

    let parent = path.posix.dirname(relativePath);
    while (parent !== ".") {
      parents.add(parent);
      parent = path.posix.dirname(parent);
    }
  }

  for (const relativePath of [...parents].sort((left, right) => right.split("/").length - left.split("/").length)) {
    const { absolute } = resolveRepoPath(repoRoot, relativePath);
    await rmdir(absolute).catch((error) => {
      if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error;
    });
  }
}

async function markBaselineEnded(storageRoot, checkpointId) {
  const records = await loadCatalog(storageRoot);
  const updated = records.map((record) => record.id === checkpointId ? { ...record, status: "ended" } : record);
  await saveCatalog(storageRoot, updated);
}

export async function rollbackEpisode({ checkpoint, boundary, safetyToken, hazards = {} }) {
  if (!checkpoint?.rollback?.enabled) {
    return { ok: false, rollback: checkpoint?.rollback ?? disabled(DISABLED_REASONS.NOT_A_GIT_REPOSITORY) };
  }
  if (!checkpoint?.repoRoot) {
    return { ok: false, rollback: checkpoint?.rollback ?? disabled(DISABLED_REASONS.NOT_A_GIT_REPOSITORY) };
  }
  await assertFixtureAuthorization(checkpoint.repoRoot, safetyToken);
  let release;
  try {
    release = await acquireProjectLock(checkpoint.storageRoot, checkpoint.projectId);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return { ok: false, rollback: disabled(DISABLED_REASONS.CONCURRENT_EDIT, { message: "rollback lock is already held" }) };
    }
    throw error;
  }
  let recovery = null;

  try {
    const state = await captureRepositoryState(checkpoint.repoRoot);
    let eligibility = await evaluateState({ checkpoint, boundary, hazards }, state);
    if (!eligibility.enabled) return { ok: false, rollback: eligibility };

    const originalCatalog = await loadCatalog(checkpoint.storageRoot);
    const reservation = await reserveRetention(checkpoint.storageRoot, originalCatalog, {
      projectId: checkpoint.projectId,
      maxBytes: checkpoint.limits.projectBytes,
      incomingBytes: boundary.size.totalBytes,
    });
    if (!reservation.ok) {
      return { ok: false, rollback: disabled(DISABLED_REASONS.RETENTION_CAPACITY_EXHAUSTED) };
    }

    recovery = await createRecoverySnapshot(checkpoint, boundary, state, reservation.records);
    const afterSnapshot = await captureRepositoryState(checkpoint.repoRoot);
    eligibility = await evaluateState({ checkpoint, boundary, hazards }, afterSnapshot);
    if (!eligibility.enabled) {
      return { ok: false, rollback: eligibility, recoverySnapshotPath: recovery.path };
    }

    await removeUntracked(checkpoint.repoRoot, afterSnapshot.status.untracked);
    await assertFixtureAuthorization(checkpoint.repoRoot, safetyToken);
    await runGit(checkpoint.repoRoot, ["-c", "submodule.recurse=false", "reset", "--hard", checkpoint.baselineState.head]);

    const restored = await captureRepositoryState(checkpoint.repoRoot);
    if (restored.digest !== checkpoint.baselineState.digest) {
      throw new Error("restored repository does not match the sealed baseline");
    }

    await markBaselineEnded(checkpoint.storageRoot, checkpoint.checkpointId);
    return {
      ok: true,
      rollback: enabled(),
      recoverySnapshotPath: recovery.path,
      restoredCheckpointId: checkpoint.checkpointId,
    };
  } catch (error) {
    return {
      ok: false,
      rollback: disabled("restore_failed", { message: error.message }),
      recoverySnapshotPath: recovery?.path ?? null,
    };
  } finally {
    await release();
  }
}
