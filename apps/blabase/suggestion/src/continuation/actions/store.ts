import { randomBytes } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText
} from "../../localReadMode";
import {
  appendContinuationSetupActionEvent,
  compactContinuationSetupActionStore,
  continuationSetupActionBindingSchema,
  continuationSetupActionOfferIdSchema,
  continuationSetupActionIssueResponseSchema,
  continuationSetupActionOpenResponseSchema,
  createContinuationSetupActionOffer,
  createEmptyContinuationSetupActionStore,
  verifyContinuationSetupActionBindingForSecret,
  verifyContinuationSetupActionStore,
  type ContinuationSetupActionBinding,
  type ContinuationSetupActionIssueResponse,
  type ContinuationSetupActionOffer,
  type ContinuationSetupActionOpenResponse,
  type ContinuationSetupActionStore
} from "./contracts";
import { continuationSetupActionAuthKeyId } from "./authority";
import {
  CONTINUATION_SETUP_ACTION_API_CONTRACT,
  CONTINUATION_SETUP_ACTION_DESTINATION,
  CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS,
  CONTINUATION_SETUP_ACTION_NAVIGATE_TO
} from "./versions";

const STORE_FILENAME = "events.json";
const LOCKS_DIRECTORY = "locks";
const LOCK_FILENAME = "state.lock";
const LOCK_WAIT_ATTEMPTS = 500;
const LOCK_WAIT_MS = 10;
const TEMP_PATTERN = /^events\.json\.[a-f0-9]{32}\.tmp$/u;

export class ContinuationSetupActionStoreError extends Error {
  constructor(
    public readonly code: "OFFER_NOT_CURRENT" | "STORE_UNAVAILABLE"
  ) {
    super(code);
    this.name = "ContinuationSetupActionStoreError";
  }
}

export type ContinuationSetupActionStoreReadResult =
  | { status: "available"; value: ContinuationSetupActionStore }
  | { status: "missing" }
  | { status: "invalid" };

export function continuationSetupActionLocalDirectory(
  cwd = process.cwd(),
  installationSecret: string
): string {
  return join(
    continuationSetupActionLocalRoot(cwd),
    continuationSetupActionAuthKeyId(installationSecret)
  );
}

export function continuationSetupActionLocalRoot(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "continuation-actions");
}

/** Pure authenticated read. Invalid state is never repaired or deleted. */
export async function readContinuationSetupActionStore(input: {
  cwd?: string;
  installationSecret: string;
}): Promise<ContinuationSetupActionStoreReadResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const target = join(
    continuationSetupActionLocalDirectory(cwd, input.installationSecret),
    STORE_FILENAME
  );
  let text: string;
  try {
    if (
      (await inspectLocalPrivateDirectoryChain(cwd, dirname(target))) ===
      "missing"
    ) {
      return { status: "missing" };
    }
    text = await readLocalPrivateText(target, "preserve", cwd);
  } catch (error) {
    return isNodeError(error, "ENOENT")
      ? { status: "missing" }
      : { status: "invalid" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { status: "invalid" };
  }
  const verified = verifyContinuationSetupActionStore(
    value,
    input.installationSecret
  );
  return verified === null
    ? { status: "invalid" }
    : { status: "available", value: verified };
}

export async function issueStoredContinuationSetupOffer(input: {
  cwd?: string;
  clock?: () => Date;
  resolveCurrent: (lockedNow: Date) =>
    | Promise<{
        installationSecret: string;
        binding: ContinuationSetupActionBinding;
      }>
    | {
        installationSecret: string;
        binding: ContinuationSetupActionBinding;
      };
}): Promise<ContinuationSetupActionIssueResponse> {
  const cwd = resolve(input.cwd ?? process.cwd());
  return withContinuationSetupActionLock(cwd, async () => {
    const lockedAt = sampleClock(input.clock);
    const current = await input.resolveCurrent(new Date(lockedAt.getTime()));
    const issuedAt = sampleClock(input.clock);
    if (issuedAt.getTime() < lockedAt.getTime()) throw notCurrent();
    const binding = continuationSetupActionBindingSchema.parse(
      current.binding
    );
    if (
      !verifyContinuationSetupActionBindingForSecret(
        binding,
        current.installationSecret
      ) ||
      issuedAt.getTime() >=
        Date.parse(binding.authority.candidateExpiresAt)
    ) {
      throw notCurrent();
    }
    await ensureNamespace(cwd, current.installationSecret);
    await assertNoPendingWrite(cwd, current.installationSecret);
    let store = await currentOrEmptyStore({
      cwd,
      installationSecret: current.installationSecret,
      createdAt: issuedAt.toISOString()
    });
    const initialStoreSha256 = store.storeSha256;
    store = expireActiveOffers(
      store,
      current.installationSecret,
      issuedAt.toISOString()
    );
    store = compactContinuationSetupActionStore({
      store,
      installationSecret: current.installationSecret,
      asOf: issuedAt.toISOString()
    });

    const active = activeOffers(store);
    const existing = [...active.values()].find(
      (offer) =>
        offer.binding.authority.itemRef === binding.authority.itemRef
    );
    if (existing !== undefined) {
      if (sameBinding(existing.binding, binding)) {
        if (store.storeSha256 !== initialStoreSha256) {
          await writeStore(cwd, current.installationSecret, store);
        }
        return continuationSetupActionIssueResponseSchema.parse({
          contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
          status: "issued",
          offerId: existing.offerId,
          expiresAt: existing.expiresAt
        });
      }
      store = appendBounded({
        store,
        installationSecret: current.installationSecret,
        event: {
          eventType: "terminal",
          occurredAt: issuedAt.toISOString(),
          offerId: existing.offerId,
          itemRef: existing.binding.authority.itemRef,
          terminalReason: "superseded"
        }
      });
    }

    const seen = new Set(store.events.map((event) => event.offerId));
    let offerId: string;
    do {
      offerId = `continuation_setup_offer_${randomBytes(32).toString("hex")}`;
    } while (seen.has(offerId));
    const offer = createContinuationSetupActionOffer({
      binding,
      issuedAt: issuedAt.toISOString(),
      offerId
    });
    store = appendBounded({
      store,
      installationSecret: current.installationSecret,
      event: { eventType: "issued", occurredAt: offer.issuedAt, offer }
    });
    await writeStore(cwd, current.installationSecret, store);
    return continuationSetupActionIssueResponseSchema.parse({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "issued",
      offerId: offer.offerId,
      expiresAt: offer.expiresAt
    });
  });
}

export async function consumeStoredContinuationSetupOffer(input: {
  cwd?: string;
  offerId: string;
  clock?: () => Date;
  revalidate: (lockedNow: Date) =>
    | Promise<{
        installationSecret: string;
        currentBindings: ContinuationSetupActionBinding[];
      }>
    | {
        installationSecret: string;
        currentBindings: ContinuationSetupActionBinding[];
      };
}): Promise<ContinuationSetupActionOpenResponse> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const offerId = continuationSetupActionOfferIdSchema.parse(input.offerId);
  return withContinuationSetupActionLock(cwd, async () => {
    const lockedAt = sampleClock(input.clock);
    const authority = await input.revalidate(new Date(lockedAt.getTime()));
    const validatedAt = sampleClock(input.clock);
    if (validatedAt.getTime() < lockedAt.getTime()) {
      throw notCurrent();
    }
    const bindings = authority.currentBindings.map((binding) =>
      continuationSetupActionBindingSchema.parse(binding)
    );
    if (
      bindings.some(
        (binding) =>
          !verifyContinuationSetupActionBindingForSecret(
            binding,
            authority.installationSecret
          )
      )
    ) {
      throw notCurrent();
    }
    await ensureNamespace(cwd, authority.installationSecret);
    await assertNoPendingWrite(cwd, authority.installationSecret);
    const read = await readContinuationSetupActionStore({
      cwd,
      installationSecret: authority.installationSecret
    });
    if (read.status !== "available") throw notCurrent();
    let store = expireActiveOffers(
      read.value,
      authority.installationSecret,
      validatedAt.toISOString()
    );
    store = compactContinuationSetupActionStore({
      store,
      installationSecret: authority.installationSecret,
      asOf: validatedAt.toISOString()
    });
    const offer = activeOffers(store).get(offerId);
    if (offer === undefined) {
      if (store.storeSha256 !== read.value.storeSha256) {
        await writeStore(cwd, authority.installationSecret, store);
      }
      throw notCurrent();
    }
    if (
      validatedAt.getTime() >= Date.parse(offer.expiresAt) ||
      validatedAt.getTime() >=
        Date.parse(offer.binding.authority.candidateExpiresAt)
    ) {
      store = appendBounded({
        store,
        installationSecret: authority.installationSecret,
        event: {
          eventType: "terminal",
          occurredAt: validatedAt.toISOString(),
          offerId,
          itemRef: offer.binding.authority.itemRef,
          terminalReason: "expired"
        }
      });
      await writeStore(cwd, authority.installationSecret, store);
      throw notCurrent();
    }

    const current = bindings.find((binding) =>
      sameBinding(binding, offer.binding)
    );
    if (current === undefined) {
      store = appendBounded({
        store,
        installationSecret: authority.installationSecret,
        event: {
          eventType: "terminal",
          occurredAt: validatedAt.toISOString(),
          offerId,
          itemRef: offer.binding.authority.itemRef,
          terminalReason: "revalidation_failed"
        }
      });
      await writeStore(cwd, authority.installationSecret, store);
      throw notCurrent();
    }

    store = appendBounded({
      store,
      installationSecret: authority.installationSecret,
      event: {
        eventType: "terminal",
        occurredAt: validatedAt.toISOString(),
        offerId,
        itemRef: offer.binding.authority.itemRef,
        terminalReason: "consumed"
      }
    });
    await writeStore(cwd, authority.installationSecret, store);
    return continuationSetupActionOpenResponseSchema.parse({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "opened",
      destination: CONTINUATION_SETUP_ACTION_DESTINATION,
      navigateTo: CONTINUATION_SETUP_ACTION_NAVIGATE_TO
    });
  });
}

function appendBounded(
  input: Parameters<typeof appendContinuationSetupActionEvent>[0]
): ContinuationSetupActionStore {
  const activeCount = activeOffers(input.store).size;
  const projectedReservedSize =
    input.event.eventType === "issued"
      ? input.store.events.length + activeCount + 2
      : input.store.events.length + 1;
  if (
    projectedReservedSize >
    CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS
  ) {
    throw new ContinuationSetupActionStoreError("STORE_UNAVAILABLE");
  }
  return appendContinuationSetupActionEvent(input);
}

function expireActiveOffers(
  inputStore: ContinuationSetupActionStore,
  installationSecret: string,
  occurredAt: string
): ContinuationSetupActionStore {
  let store = inputStore;
  const nowMs = Date.parse(occurredAt);
  for (const offer of activeOffers(store).values()) {
    if (Date.parse(offer.expiresAt) > nowMs) continue;
    store = appendBounded({
      store,
      installationSecret,
      event: {
        eventType: "terminal",
        occurredAt,
        offerId: offer.offerId,
        itemRef: offer.binding.authority.itemRef,
        terminalReason: "expired"
      }
    });
  }
  return store;
}

function activeOffers(
  store: ContinuationSetupActionStore
): Map<string, ContinuationSetupActionOffer> {
  const active = new Map<string, ContinuationSetupActionOffer>();
  for (const event of store.events) {
    if (event.eventType === "issued" && event.offer !== null) {
      active.set(event.offerId, event.offer);
    } else {
      active.delete(event.offerId);
    }
  }
  return active;
}

function sameBinding(
  left: ContinuationSetupActionBinding,
  right: ContinuationSetupActionBinding
): boolean {
  return (
    left.authority.authoritySha256 === right.authority.authoritySha256
  );
}

async function currentOrEmptyStore(input: {
  cwd: string;
  installationSecret: string;
  createdAt: string;
}): Promise<ContinuationSetupActionStore> {
  const read = await readContinuationSetupActionStore(input);
  if (read.status === "invalid") throw notCurrent();
  return read.status === "available"
    ? read.value
    : createEmptyContinuationSetupActionStore({
        ...input,
        authKeyId: continuationSetupActionAuthKeyId(
          input.installationSecret
        )
      });
}

async function withContinuationSetupActionLock<T>(
  cwd: string,
  operation: () => Promise<T>
): Promise<T> {
  const directory = continuationSetupActionLocalRoot(cwd);
  const locks = join(directory, LOCKS_DIRECTORY);
  await ensurePrivateDirectoryChain(cwd, [
    join(cwd, ".local"),
    directory,
    locks
  ]);
  const path = join(locks, LOCK_FILENAME);
  let handle: FileHandle | null = null;
  let identity: Stats | null = null;
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(
        path,
        fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_RDWR |
          fsConstants.O_NOFOLLOW,
        0o600
      );
      const token = randomBytes(32).toString("hex");
      await handle.writeFile(`${token}\n`, "utf8");
      await handle.sync();
      identity = await handle.stat();
      await assertPrivateFileIdentity(path, identity);
      break;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = null;
      identity = null;
      if (!isNodeError(error, "EEXIST")) throw unavailable();
      await wait(LOCK_WAIT_MS);
    }
  }
  if (handle === null || identity === null) throw unavailable();
  try {
    return await operation();
  } finally {
    try {
      await assertPrivateFileIdentity(path, identity);
      await unlink(path);
      await syncDirectory(locks);
    } catch {
      throw unavailable();
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

async function ensureNamespace(
  cwd: string,
  installationSecret: string
): Promise<void> {
  await ensurePrivateDirectoryChain(cwd, [
    continuationSetupActionLocalDirectory(cwd, installationSecret)
  ]);
}

async function ensurePrivateDirectoryChain(
  cwd: string,
  directories: string[]
): Promise<void> {
  const root = resolve(cwd);
  const rootMetadata = await lstat(root).catch(() => null);
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (
    rootMetadata === null ||
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (uid !== undefined && rootMetadata.uid !== uid)
  ) {
    throw unavailable();
  }
  for (const value of directories) {
    const directory = resolve(value);
    const relativePath = relative(root, directory);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      relativePath.startsWith(sep)
    ) {
      throw unavailable();
    }
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw unavailable();
    }
    const metadata = await lstat(directory).catch(() => null);
    if (
      metadata === null ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      (uid !== undefined && metadata.uid !== uid)
    ) {
      throw unavailable();
    }
  }
}

async function assertNoPendingWrite(
  cwd: string,
  installationSecret: string
): Promise<void> {
  const names = await readdir(
    continuationSetupActionLocalDirectory(cwd, installationSecret)
  );
  if (names.some((name) => TEMP_PATTERN.test(name))) throw unavailable();
}

async function writeStore(
  cwd: string,
  installationSecret: string,
  store: ContinuationSetupActionStore
): Promise<void> {
  const target = join(
    continuationSetupActionLocalDirectory(cwd, installationSecret),
    STORE_FILENAME
  );
  const temporary = `${target}.${randomBytes(16).toString("hex")}.tmp`;
  let handle: FileHandle | null = null;
  try {
    handle = await open(
      temporary,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(`${JSON.stringify(store, null, 2)}\n`, "utf8");
    await handle.sync();
    const metadata = await handle.stat();
    if (!privateFileMetadata(metadata)) throw unavailable();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    const installed = await lstat(target);
    if (!privateFileMetadata(installed) || installed.isSymbolicLink()) {
      throw unavailable();
    }
    await syncDirectory(dirname(target));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (error instanceof ContinuationSetupActionStoreError) throw error;
    throw unavailable();
  }
}

async function assertPrivateFileIdentity(
  path: string,
  expected: Stats
): Promise<void> {
  const current = await lstat(path);
  if (
    !privateFileMetadata(current) ||
    current.isSymbolicLink() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw unavailable();
  }
}

function privateFileMetadata(metadata: Stats): boolean {
  const uid = process.geteuid?.() ?? process.getuid?.();
  return (
    metadata.isFile() &&
    (metadata.mode & 0o777) === 0o600 &&
    (uid === undefined || metadata.uid === uid)
  );
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sampleClock(clock: (() => Date) | undefined): Date {
  const sampled = clock?.() ?? new Date();
  if (!(sampled instanceof Date)) throw unavailable();
  return canonicalDate(sampled.toISOString());
}

function canonicalDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw notCurrent();
  }
  return date;
}

function notCurrent(): ContinuationSetupActionStoreError {
  return new ContinuationSetupActionStoreError("OFFER_NOT_CURRENT");
}

function unavailable(): ContinuationSetupActionStoreError {
  return new ContinuationSetupActionStoreError("STORE_UNAVAILABLE");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
