import { randomBytes } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { compareRuntimeStrings } from "../crossSource/canonicalHash";
import { inspectLocalPrivateDirectoryChain } from "../localReadMode";
import {
  MAX_WORK_ARTIFACT_ATTRIBUTION_DECISIONS,
  WORK_ARTIFACT_ATTRIBUTIONS_FILENAME,
  WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS,
  WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION,
  WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
  WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT,
  createWorkArtifactAttributionId,
  githubArtifactIdentityKey,
  githubArtifactIdentitySchema,
  isWorkArtifactAttributionTempFilename,
  sealWorkArtifactAttributionStore,
  workArtifactAttributionIdSchema,
  workArtifactAttributionStoreSchema,
  type GitHubArtifactIdentity,
  type WorkArtifactAttributionDecision,
  type WorkArtifactAttributionStore
} from "./contracts";

const EMPTY_ARTIFACT_ATTRIBUTION_STORE_TIMESTAMP =
  "1970-01-01T00:00:00.000Z";

export class WorkArtifactAttributionError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
      | "ATTRIBUTION_NOT_FOUND"
      | "ATTRIBUTION_NOT_ACTIVE"
      | "ARTIFACT_IDENTITY_CONFLICT"
      | "DECISION_TIME_REGRESSION"
  ) {
    super(code);
    this.name = "WorkArtifactAttributionError";
  }
}

export function createEmptyWorkArtifactAttributionStore(
  updatedAt: string
): WorkArtifactAttributionStore {
  return sealWorkArtifactAttributionStore({
    contract: WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT,
    schemaVersion: WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
    retentionPolicyVersion:
      WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION,
    revision: 0,
    prunedDecisionCount: 0,
    updatedAt: new Date(updatedAt).toISOString(),
    decisions: []
  });
}

export function attachWorkArtifactAttribution(
  storeInput: WorkArtifactAttributionStore,
  input: {
    managedRunId: string;
    bindingId: string;
    executionId: string;
    executesRelationId: string;
    artifact: GitHubArtifactIdentity;
    attachedAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: WorkArtifactAttributionStore;
  decision: WorkArtifactAttributionDecision;
  changed: boolean;
} {
  assertExplicitConfirmation(input.explicitUserConfirmation);
  const store = workArtifactAttributionStoreSchema.parse(storeInput);
  const artifact = githubArtifactIdentitySchema.parse(input.artifact);
  const attachedAt = assertDecisionTime(store, input.attachedAt);
  const current = currentDecisionForArtifact(store, artifact);

  if (
    current?.artifact.kind === "github_pull_request" &&
    artifact.kind === "github_pull_request" &&
    current.artifact.number !== artifact.number
  ) {
    throw new WorkArtifactAttributionError(
      "ARTIFACT_IDENTITY_CONFLICT"
    );
  }
  if (
    current?.action === "attach" &&
    sameProducer(current, input)
  ) {
    return { store, decision: current, changed: false };
  }

  const core = {
    action: "attach" as const,
    managedRunId: input.managedRunId,
    bindingId: input.bindingId,
    executionId: input.executionId,
    executesRelationId: input.executesRelationId,
    artifact,
    decidedAt: attachedAt,
    decisionSource: "explicit_user" as const,
    supersedesAttributionId: current?.attributionId ?? null
  };
  const decision = workArtifactAttributionDecision(core);
  return {
    store: appendDecision(store, decision),
    decision,
    changed: true
  };
}

export function detachWorkArtifactAttribution(
  storeInput: WorkArtifactAttributionStore,
  input: {
    attributionId: string;
    detachedAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: WorkArtifactAttributionStore;
  decision: WorkArtifactAttributionDecision;
} {
  assertExplicitConfirmation(input.explicitUserConfirmation);
  const store = workArtifactAttributionStoreSchema.parse(storeInput);
  const attributionId = workArtifactAttributionIdSchema.parse(
    input.attributionId
  );
  const attached = store.decisions.find(
    (decision) => decision.attributionId === attributionId
  );
  if (!attached) {
    throw new WorkArtifactAttributionError("ATTRIBUTION_NOT_FOUND");
  }
  const current = currentDecisionForArtifact(store, attached.artifact);
  if (
    attached.action !== "attach" ||
    current?.attributionId !== attached.attributionId
  ) {
    throw new WorkArtifactAttributionError("ATTRIBUTION_NOT_ACTIVE");
  }

  const core = {
    action: "detach" as const,
    managedRunId: attached.managedRunId,
    bindingId: attached.bindingId,
    executionId: attached.executionId,
    executesRelationId: attached.executesRelationId,
    artifact: attached.artifact,
    decidedAt: assertDecisionTime(store, input.detachedAt),
    decisionSource: "explicit_user" as const,
    supersedesAttributionId: attached.attributionId
  };
  const decision = workArtifactAttributionDecision(core);
  return {
    store: appendDecision(store, decision),
    decision
  };
}

export function currentWorkArtifactAttributions(
  storeInput: WorkArtifactAttributionStore
): WorkArtifactAttributionDecision[] {
  const store = workArtifactAttributionStoreSchema.parse(storeInput);
  const current = new Map<string, WorkArtifactAttributionDecision>();
  for (const decision of store.decisions) {
    current.set(githubArtifactIdentityKey(decision.artifact), decision);
  }
  return [...current.values()]
    .filter((decision) => decision.action === "attach")
    .sort((left, right) =>
      compareRuntimeStrings(left.attributionId, right.attributionId)
    );
}

export function pruneWorkArtifactAttributionStore(
  storeInput: WorkArtifactAttributionStore,
  now = new Date()
): {
  store: WorkArtifactAttributionStore;
  changed: boolean;
} {
  const store = workArtifactAttributionStoreSchema.parse(storeInput);
  const cutoff =
    now.getTime() -
    WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  const withinRetention = store.decisions.filter(
    (decision) => Date.parse(decision.decidedAt) >= cutoff
  );
  const retained = withinRetention.slice(
    -MAX_WORK_ARTIFACT_ATTRIBUTION_DECISIONS
  );
  const removed = store.decisions.length - retained.length;
  if (removed === 0) return { store, changed: false };
  const updatedAt = new Date(
    Math.max(Date.parse(store.updatedAt), now.getTime())
  ).toISOString();
  return {
    store: sealWorkArtifactAttributionStore({
      contract: WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT,
      schemaVersion: WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
      retentionPolicyVersion:
        WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION,
      revision: store.revision,
      prunedDecisionCount: store.prunedDecisionCount + removed,
      updatedAt,
      decisions: retained
    }),
    changed: true
  };
}

/**
 * Production callers read and write this file while holding the shared Work
 * Resumption state lease. The file helper intentionally does not acquire a
 * second lock, which would invert or nest the established state lock order.
 */
export async function readWorkArtifactAttributionStore(
  cwd = process.cwd(),
  now = new Date()
): Promise<WorkArtifactAttributionStore> {
  await cleanupWorkArtifactAttributionTempFiles(cwd);
  const path = workArtifactAttributionPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return createEmptyWorkArtifactAttributionStore(
        EMPTY_ARTIFACT_ATTRIBUTION_STORE_TIMESTAMP
      );
    }
    throw new WorkArtifactAttributionError("STORE_READ_FAILED");
  }

  let parsed: WorkArtifactAttributionStore;
  try {
    parsed = workArtifactAttributionStoreSchema.parse(JSON.parse(raw));
  } catch {
    await cleanupExpiredInvalidAttributionStore(path, now);
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
  const pruned = pruneWorkArtifactAttributionStore(parsed, now);
  if (pruned.changed) {
    await writeWorkArtifactAttributionStore(pruned.store, cwd);
  }
  return pruned.store;
}

/**
 * Reads the attribution ledger without acquiring a lease or performing local
 * maintenance. Pending, unsafe, or unstable state fails closed and is left
 * byte-for-byte in place. Retention is applied only to the returned value.
 */
export async function readWorkArtifactAttributionStorePreservingState(
  cwd = process.cwd(),
  now = new Date()
): Promise<WorkArtifactAttributionStore> {
  const target = workArtifactAttributionPath(cwd);
  await assertAttributionPreserveBoundary(cwd);
  const read = await readStablePrivateText(target);

  if (read.status === "missing") {
    await assertAttributionPreserveBoundary(cwd);
    await assertPathStillMissing(target);
    return createEmptyWorkArtifactAttributionStore(
      EMPTY_ARTIFACT_ATTRIBUTION_STORE_TIMESTAMP
    );
  }

  let parsed: WorkArtifactAttributionStore;
  try {
    parsed = workArtifactAttributionStoreSchema.parse(
      JSON.parse(read.text)
    );
  } catch {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }

  await assertAttributionPreserveBoundary(cwd);
  await assertStablePathFingerprint(target, read.fingerprint);
  return pruneWorkArtifactAttributionStore(parsed, now).store;
}

export async function writeWorkArtifactAttributionStore(
  storeInput: WorkArtifactAttributionStore,
  cwd = process.cwd()
): Promise<void> {
  const store = workArtifactAttributionStoreSchema.parse(storeInput);
  const target = workArtifactAttributionPath(cwd);
  const directory = dirname(target);
  let temporary: string | null = null;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await cleanupWorkArtifactAttributionTempFiles(cwd);
    temporary = `${target}.${process.pid}.${randomBytes(8).toString(
      "hex"
    )}.tmp`;
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch {
    if (temporary) await unlink(temporary).catch(() => undefined);
    throw new WorkArtifactAttributionError("STORE_WRITE_FAILED");
  }
}

export async function clearWorkArtifactAttributionStore(
  cwd = process.cwd()
): Promise<void> {
  await unlink(workArtifactAttributionPath(cwd)).catch((error) => {
    if (!isNodeError(error, "ENOENT")) {
      throw new WorkArtifactAttributionError("STORE_WRITE_FAILED");
    }
  });
  await cleanupWorkArtifactAttributionTempFiles(cwd);
}

export function workArtifactAttributionPath(
  cwd = process.cwd()
): string {
  return join(
    cwd,
    ".local",
    "work-resumption",
    WORK_ARTIFACT_ATTRIBUTIONS_FILENAME
  );
}

export async function cleanupWorkArtifactAttributionTempFiles(
  cwd = process.cwd()
): Promise<void> {
  const directory = dirname(workArtifactAttributionPath(cwd));
  let filenames: string[];
  try {
    filenames = await readdir(directory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new WorkArtifactAttributionError("STORE_READ_FAILED");
  }
  await Promise.all(
    filenames
      .filter(isWorkArtifactAttributionTempFilename)
      .map((filename) =>
        unlink(join(directory, filename)).catch((error) => {
          if (!isNodeError(error, "ENOENT")) {
            throw new WorkArtifactAttributionError(
              "STORE_WRITE_FAILED"
            );
          }
        })
      )
  );
}

async function cleanupExpiredInvalidAttributionStore(
  path: string,
  now: Date
): Promise<void> {
  try {
    const metadata = await stat(path);
    const retentionMs =
      WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS *
      24 *
      60 *
      60 *
      1_000;
    if (now.getTime() - metadata.mtimeMs >= retentionMs) {
      await unlink(path);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw new WorkArtifactAttributionError("STORE_WRITE_FAILED");
    }
  }
}

type StableFileFingerprint = {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  size: number;
  modifiedAtMs: number;
  changedAtMs: number;
};

type StablePrivateTextRead =
  | { status: "missing" }
  | {
      status: "available";
      text: string;
      fingerprint: StableFileFingerprint;
    };

async function assertAttributionPreserveBoundary(
  cwd: string
): Promise<void> {
  const directory = dirname(workArtifactAttributionPath(cwd));
  let directoryChain: "available" | "missing";
  try {
    directoryChain = await inspectLocalPrivateDirectoryChain(cwd, directory);
  } catch {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
  if (directoryChain === "missing") return;
  const directoryMetadata = await lstatIfPresent(directory);
  if (directoryMetadata === null) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
  assertPrivateDirectory(directoryMetadata);

  let filenames: string[];
  try {
    filenames = await readdir(directory);
  } catch {
    throw new WorkArtifactAttributionError("STORE_READ_FAILED");
  }
  if (filenames.some(isWorkArtifactAttributionTempFilename)) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }

  const locksDirectory = join(directory, "locks");
  const locksMetadata = await lstatIfPresent(locksDirectory);
  if (locksMetadata === null) return;
  assertPrivateDirectory(locksMetadata);
  let lockFilenames: string[];
  try {
    lockFilenames = await readdir(locksDirectory);
  } catch {
    throw new WorkArtifactAttributionError("STORE_READ_FAILED");
  }
  if (lockFilenames.includes("state.lock")) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
}

async function readStablePrivateText(
  path: string
): Promise<StablePrivateTextRead> {
  const pathMetadata = await lstatIfPresent(path);
  if (pathMetadata === null) return { status: "missing" };
  assertPrivateFile(pathMetadata);
  const expected = stableFileFingerprint(pathMetadata);

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const before = await handle.stat();
    assertPrivateFile(before);
    if (!sameStableFileFingerprint(expected, stableFileFingerprint(before))) {
      throw new WorkArtifactAttributionError("STORE_INVALID");
    }
    const text = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat();
    assertPrivateFile(after);
    if (!sameStableFileFingerprint(expected, stableFileFingerprint(after))) {
      throw new WorkArtifactAttributionError("STORE_INVALID");
    }
    await handle.close();
    handle = null;
    await assertStablePathFingerprint(path, expected);
    return { status: "available", text, fingerprint: expected };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof WorkArtifactAttributionError) throw error;
    if (
      isNodeError(error, "ELOOP") ||
      isNodeError(error, "ENOENT") ||
      isNodeError(error, "ENOTDIR")
    ) {
      throw new WorkArtifactAttributionError("STORE_INVALID");
    }
    throw new WorkArtifactAttributionError("STORE_READ_FAILED");
  }
}

async function assertStablePathFingerprint(
  path: string,
  expected: StableFileFingerprint
): Promise<void> {
  const metadata = await lstatIfPresent(path);
  if (metadata === null) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
  assertPrivateFile(metadata);
  if (
    !sameStableFileFingerprint(expected, stableFileFingerprint(metadata))
  ) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
}

async function assertPathStillMissing(path: string): Promise<void> {
  if ((await lstatIfPresent(path)) !== null) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
}

async function lstatIfPresent(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    if (isNodeError(error, "ENOTDIR")) {
      throw new WorkArtifactAttributionError("STORE_INVALID");
    }
    throw new WorkArtifactAttributionError("STORE_READ_FAILED");
  }
}

function assertPrivateDirectory(metadata: Stats): void {
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser(metadata) ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
}

function assertPrivateFile(metadata: Stats): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !ownedByCurrentUser(metadata) ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
}

function ownedByCurrentUser(metadata: Stats): boolean {
  const currentUid = process.getuid?.();
  return currentUid === undefined || metadata.uid === currentUid;
}

function stableFileFingerprint(metadata: Stats): StableFileFingerprint {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode & 0o777,
    ownerUid: metadata.uid,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    changedAtMs: metadata.ctimeMs
  };
}

function sameStableFileFingerprint(
  left: StableFileFingerprint,
  right: StableFileFingerprint
): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.ownerUid === right.ownerUid &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.changedAtMs === right.changedAtMs
  );
}

function currentDecisionForArtifact(
  store: WorkArtifactAttributionStore,
  artifact: GitHubArtifactIdentity
): WorkArtifactAttributionDecision | undefined {
  const key = githubArtifactIdentityKey(artifact);
  return [...store.decisions]
    .reverse()
    .find(
      (decision) => githubArtifactIdentityKey(decision.artifact) === key
    );
}

function appendDecision(
  store: WorkArtifactAttributionStore,
  decision: WorkArtifactAttributionDecision
): WorkArtifactAttributionStore {
  const all = [...store.decisions, decision];
  const decisions = all.slice(-MAX_WORK_ARTIFACT_ATTRIBUTION_DECISIONS);
  const removed = all.length - decisions.length;
  return sealWorkArtifactAttributionStore({
    contract: WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT,
    schemaVersion: WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
    retentionPolicyVersion:
      WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION,
    revision: store.revision + 1,
    prunedDecisionCount: store.prunedDecisionCount + removed,
    updatedAt: decision.decidedAt,
    decisions
  });
}

function workArtifactAttributionDecision(
  core: Parameters<typeof createWorkArtifactAttributionId>[0]
): WorkArtifactAttributionDecision {
  return {
    ...core,
    attributionId: createWorkArtifactAttributionId(core)
  };
}

function sameProducer(
  decision: WorkArtifactAttributionDecision,
  input: {
    managedRunId: string;
    bindingId: string;
    executionId: string;
    executesRelationId: string;
  }
): boolean {
  return (
    decision.managedRunId === input.managedRunId &&
    decision.bindingId === input.bindingId &&
    decision.executionId === input.executionId &&
    decision.executesRelationId === input.executesRelationId
  );
}

function assertDecisionTime(
  store: WorkArtifactAttributionStore,
  input: string
): string {
  const timestamp = new Date(input).toISOString();
  const last = store.decisions[store.decisions.length - 1];
  const lowerBound = Math.max(
    Date.parse(store.updatedAt),
    last ? Date.parse(last.decidedAt) : Number.NEGATIVE_INFINITY
  );
  if (Date.parse(timestamp) < lowerBound) {
    throw new WorkArtifactAttributionError(
      "DECISION_TIME_REGRESSION"
    );
  }
  return timestamp;
}

function assertExplicitConfirmation(value: true): void {
  if (value !== true) {
    throw new WorkArtifactAttributionError("STORE_INVALID");
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
