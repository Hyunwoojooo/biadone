import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText,
  type LocalReadMode
} from "../../localReadMode";
import { withWorkResumptionStateLease } from "../../resumption/store";
import {
  appendSemanticValidationReceipt,
  createEmptySemanticValidationStore,
  verifySemanticValidationStore,
  type SemanticValidationReceipt,
  type SemanticValidationStore
} from "./contracts";

const STORE_FILENAME = "receipts.json";
const RUN_LOCK_FILENAME = "run.lock";
const RUN_LOCK_STALE_MS = 30_000;
const RUN_LOCK_RENEW_MS = 5_000;

export type SemanticValidationStoreReadResult =
  | { status: "available"; value: SemanticValidationStore }
  | { status: "missing" }
  | {
      status: "invalid";
      reason:
        | "PARSE_FAILED"
        | "AUTHORITY_INVALID"
        | "READ_FAILED";
    };

export class SemanticValidationStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_WRITE_FAILED"
      | "RUN_LEASE_FAILED"
  ) {
    super(code);
    this.name = "SemanticValidationStoreError";
  }
}

export function semanticValidationLocalDirectory(
  cwd: string
): string {
  return join(cwd, ".local", "semantic-continuation", "validation");
}

/** Pure read: malformed or unauthenticated state is never rewritten. */
export async function readSemanticValidationStore(
  cwd: string,
  installationSecret: string,
  mode: LocalReadMode = "maintain"
): Promise<SemanticValidationStoreReadResult> {
  const target = join(semanticValidationLocalDirectory(cwd), STORE_FILENAME);
  let text: string;
  try {
    if (
      mode === "preserve" &&
      (await inspectLocalPrivateDirectoryChain(
        cwd,
        dirname(target)
      )) === "missing"
    ) {
      return { status: "missing" };
    }
    text = await readLocalPrivateText(target, mode, cwd);
  } catch (error) {
    return isNodeError(error, "ENOENT")
      ? { status: "missing" }
      : { status: "invalid", reason: "READ_FAILED" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "PARSE_FAILED" };
  }
  const verified = verifySemanticValidationStore(value, installationSecret);
  return verified === null
    ? { status: "invalid", reason: "AUTHORITY_INVALID" }
    : { status: "available", value: verified };
}

/**
 * The Work Resumption state lease is reused as the local semantic authority
 * lease. SC-001 confirmation and SC-002 run-start both pass through it.
 */
export function withSemanticContinuationAuthorityLease<T>(
  cwd: string,
  operation: () => Promise<T>
): Promise<T> {
  return withWorkResumptionStateLease(cwd, operation);
}

export async function appendStoredSemanticValidationReceipt(input: {
  cwd: string;
  installationSecret: string;
  receipt: SemanticValidationReceipt;
  createAt: string;
}): Promise<SemanticValidationStore> {
  return withSemanticContinuationAuthorityLease(input.cwd, () =>
    appendStoredSemanticValidationReceiptUnderAuthorityLease(input)
  );
}

/** Caller must hold withSemanticContinuationAuthorityLease. */
export async function appendStoredSemanticValidationReceiptUnderAuthorityLease(input: {
  cwd: string;
  installationSecret: string;
  receipt: SemanticValidationReceipt;
  createAt: string;
}): Promise<SemanticValidationStore> {
  const read = await readSemanticValidationStore(
    input.cwd,
    input.installationSecret
  );
  if (read.status === "invalid") {
    throw new SemanticValidationStoreError("STORE_INVALID");
  }
  const store =
    read.status === "available"
      ? read.value
      : createEmptySemanticValidationStore({
          createdAt: input.createAt,
          installationSecret: input.installationSecret
        });
  const updated = appendSemanticValidationReceipt({
    store,
    receipt: input.receipt,
    installationSecret: input.installationSecret
  });
  await writePrivateJson(
    join(semanticValidationLocalDirectory(input.cwd), STORE_FILENAME),
    updated
  );
  return updated;
}

export type SemanticValidationRunLease = {
  runId: string;
  abandonedRunId: string | null;
  assertCurrent: () => Promise<void>;
  stop: () => Promise<void>;
};

export async function acquireSemanticValidationRunLease(input: {
  cwd: string;
  runId: string;
}): Promise<SemanticValidationRunLease | null> {
  return withSemanticContinuationAuthorityLease(input.cwd, () =>
    acquireSemanticValidationRunLeaseUnderAuthority(input)
  );
}

async function acquireSemanticValidationRunLeaseUnderAuthority(input: {
  cwd: string;
  runId: string;
}): Promise<SemanticValidationRunLease | null> {
  const directory = semanticValidationLocalDirectory(input.cwd);
  await ensurePrivateStorePath(directory);
  const path = join(directory, RUN_LOCK_FILENAME);
  let abandonedRunId: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomBytes(16).toString("hex");
    let handle;
    let created = false;
    try {
      handle = await open(path, "wx", 0o600);
      created = true;
      await handle.writeFile(
        `${JSON.stringify({ token, ownerPid: process.pid, runId: input.runId })}\n`,
        "utf8"
      );
      const metadata = await handle.stat();
      await handle.close();
      await chmod(path, 0o600);
      return runLease({
        path,
        token,
        ownerPid: process.pid,
        device: metadata.dev,
        inode: metadata.ino,
        runId: input.runId,
        abandonedRunId
      });
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!isNodeError(error, "EEXIST")) {
        if (created) {
          await removeRunLockIfOwned(path, token).catch(() => undefined);
        }
        throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
      }
      const stale = await staleDeadRunLock(path);
      if (stale === null) return null;
      abandonedRunId = stale.runId;
      // The exported acquire path holds the shared filesystem authority lease,
      // so no second SC-001/SC-002 mutator can replace this lock between the
      // confirmed stale snapshot and unlink.
      await unlink(path).catch((unlinkError) => {
        if (!isNodeError(unlinkError, "ENOENT")) throw unlinkError;
      });
    }
  }
  return null;
}

type RunLeaseIdentity = {
  path: string;
  token: string;
  ownerPid: number;
  device: number;
  inode: number;
  runId: string;
  abandonedRunId: string | null;
};

function runLease(identity: RunLeaseIdentity): SemanticValidationRunLease {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let renewal: Promise<void> = Promise.resolve();
  let renewalFailed = false;

  const schedule = () => {
    if (stopped || renewalFailed) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped || renewalFailed) return;
      renewal = renewRunLock(identity).catch(() => {
        renewalFailed = true;
      });
      void renewal.then(schedule);
    }, RUN_LOCK_RENEW_MS);
    timer.unref?.();
  };
  schedule();

  return {
    runId: identity.runId,
    abandonedRunId: identity.abandonedRunId,
    assertCurrent: async () => {
      await renewal;
      const current = await readRunLock(identity.path);
      if (!runLockBelongsTo(current, identity) || renewalFailed || stopped) {
        throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
      }
    },
    stop: async () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      await renewal;
      const current = await readRunLock(identity.path);
      if (!runLockBelongsTo(current, identity) || renewalFailed) {
        throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
      }
      await unlink(identity.path);
    }
  };
}

async function renewRunLock(identity: RunLeaseIdentity): Promise<void> {
  const before = await readRunLock(identity.path);
  if (!runLockBelongsTo(before, identity)) {
    throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
  }
  const renewedAt = new Date(Math.max(Date.now(), before.modifiedAtMs + 1));
  await utimes(identity.path, renewedAt, renewedAt);
  const after = await readRunLock(identity.path);
  if (!runLockBelongsTo(after, identity)) {
    throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
  }
}

async function staleDeadRunLock(
  path: string
): Promise<RunLockSnapshot | null> {
  try {
    const first = await readRunLock(path);
    if (
      Date.now() - first.modifiedAtMs <= RUN_LOCK_STALE_MS ||
      processMayBeAlive(first.ownerPid)
    ) {
      return null;
    }
    const confirmed = await readRunLock(path);
    return sameRunLock(first, confirmed) &&
      Date.now() - confirmed.modifiedAtMs > RUN_LOCK_STALE_MS &&
      !processMayBeAlive(confirmed.ownerPid)
      ? confirmed
      : null;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
  }
}

type RunLockSnapshot = {
  token: string;
  ownerPid: number;
  runId: string;
  device: number;
  inode: number;
  modifiedAtMs: number;
};

async function readRunLock(path: string): Promise<RunLockSnapshot> {
  const [text, metadata] = await Promise.all([readFile(path, "utf8"), lstat(path)]);
  const parsed = JSON.parse(text) as Partial<RunLockSnapshot>;
  if (
    typeof parsed.token !== "string" ||
    typeof parsed.ownerPid !== "number" ||
    typeof parsed.runId !== "string" ||
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    throw new SemanticValidationStoreError("RUN_LEASE_FAILED");
  }
  return {
    token: parsed.token,
    ownerPid: parsed.ownerPid,
    runId: parsed.runId,
    device: metadata.dev,
    inode: metadata.ino,
    modifiedAtMs: metadata.mtimeMs
  };
}

function runLockBelongsTo(
  snapshot: RunLockSnapshot,
  identity: RunLeaseIdentity
): boolean {
  return (
    snapshot.token === identity.token &&
    snapshot.ownerPid === identity.ownerPid &&
    snapshot.runId === identity.runId &&
    snapshot.device === identity.device &&
    snapshot.inode === identity.inode
  );
}

function sameRunLock(left: RunLockSnapshot, right: RunLockSnapshot): boolean {
  return (
    left.token === right.token &&
    left.ownerPid === right.ownerPid &&
    left.runId === right.runId &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

function processMayBeAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

async function removeRunLockIfOwned(
  path: string,
  token: string
): Promise<void> {
  const snapshot = await readRunLock(path);
  if (snapshot.token === token) await unlink(path);
}

async function writePrivateJson(target: string, value: unknown): Promise<void> {
  const directory = dirname(target);
  let temporary: string | null = null;
  try {
    await ensurePrivateStorePath(directory);
    temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch {
    if (temporary !== null) await unlink(temporary).catch(() => undefined);
    throw new SemanticValidationStoreError("STORE_WRITE_FAILED");
  }
}

async function ensurePrivateStorePath(directory: string): Promise<void> {
  await ensurePrivateDirectory(dirname(dirname(directory)));
  await ensurePrivateDirectory(dirname(directory));
  await ensurePrivateDirectory(directory);
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid)
  ) {
    throw new SemanticValidationStoreError("STORE_WRITE_FAILED");
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
