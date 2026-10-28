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
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";

import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText,
  type LocalReadMode
} from "../localReadMode";

import {
  SEMANTIC_CONTINUATION_INTENT_STORE_CONTRACT,
  SEMANTIC_CONTINUATION_INTENT_STORE_SCHEMA_VERSION,
  compareSemanticIntentDecisions,
  createEmptySemanticContinuationIntentStore,
  createSemanticContinuationIntentDecision,
  sealSemanticContinuationIntentStore,
  semanticContinuationConfirmationInputSchema,
  semanticContinuationConfirmationTargetSchema,
  semanticContinuationIntentAuthKeyId,
  semanticContinuationIntentAuthKeyIdSchema,
  verifySemanticContinuationIntentStore,
  type SemanticContinuationConfirmationInput,
  type SemanticContinuationConfirmationTarget,
  type SemanticContinuationIntentDecision,
  type SemanticContinuationIntentStore
} from "./contracts";
import { withSemanticContinuationAuthorityLease } from "./validation/store";

const STORE_FILENAME = "intent-store.json";
const INTENT_TEMP_PATTERN =
  /^intent-store\.json\.\d+\.[a-f0-9]{16}\.tmp$/u;
const MUTATION_QUEUES = Symbol.for(
  "blabase.semantic-continuation-mutation-queues.v0.1"
);

export type SemanticContinuationStoreReadResult =
  | { status: "available"; value: SemanticContinuationIntentStore }
  | { status: "missing" }
  | {
      status: "invalid";
      reason: "PARSE_FAILED" | "SCHEMA_INVALID" | "READ_FAILED";
    };

export class SemanticContinuationStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_WRITE_FAILED"
      | "TARGET_EXPIRED"
  ) {
    super(code);
    this.name = "SemanticContinuationStoreError";
  }
}

export function semanticContinuationLocalDirectory(
  cwd = process.cwd(),
  installationSecret: string
): string {
  return join(
    semanticContinuationLocalRoot(cwd),
    semanticContinuationIntentAuthKeyId(installationSecret)
  );
}

export function semanticContinuationLocalRoot(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "semantic-continuation");
}

/** Pure read: invalid, missing, and expired state never rewrites the store. */
export async function readSemanticContinuationIntentStore(
  cwd: string,
  installationSecret: string,
  _mode: LocalReadMode = "maintain"
): Promise<SemanticContinuationStoreReadResult> {
  const trustedRoot = resolve(cwd);
  const target = join(
    semanticContinuationLocalDirectory(trustedRoot, installationSecret),
    STORE_FILENAME
  );
  let text: string;
  try {
    await assertNoPendingSemanticIntentWrite(
      trustedRoot,
      semanticContinuationLocalRoot(trustedRoot)
    );
    if (
      (await inspectLocalPrivateDirectoryChain(
        trustedRoot,
        dirname(target)
      )) === "missing"
    ) {
      return { status: "missing" };
    }
    await assertNoPendingSemanticIntentWrite(
      trustedRoot,
      dirname(target)
    );
    text = await readLocalPrivateText(target, "preserve", trustedRoot);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { status: "missing" };
    return { status: "invalid", reason: "READ_FAILED" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "PARSE_FAILED" };
  }
  const verified = verifySemanticContinuationIntentStore(
    value,
    installationSecret
  );
  return verified !== null
    ? { status: "available", value: verified }
    : { status: "invalid", reason: "SCHEMA_INVALID" };
}

export async function confirmStoredSemanticContinuationIntent(
  input: {
    confirmation: SemanticContinuationConfirmationInput;
    target: SemanticContinuationConfirmationTarget;
    registrySha256: string;
    confirmedAt: string;
    installationSecret: string;
  },
  cwd = process.cwd()
): Promise<{
  store: SemanticContinuationIntentStore;
  decision: SemanticContinuationIntentDecision;
}> {
  const confirmation = semanticContinuationConfirmationInputSchema.parse(
    input.confirmation
  );
  const target = semanticContinuationConfirmationTargetSchema.parse(
    input.target
  );
  if (
    Date.parse(target.observedAt) > Date.parse(input.confirmedAt) ||
    Date.parse(target.candidateExpiresAt) <= Date.parse(input.confirmedAt)
  ) {
    throw new SemanticContinuationStoreError("TARGET_EXPIRED");
  }
  const storeTarget = join(
    semanticContinuationLocalDirectory(cwd, input.installationSecret),
    STORE_FILENAME
  );
  // Validate and create the controlled chain before entering the legacy
  // Work Resumption lease. Its recursive lock-directory bootstrap predates
  // preserve-mode boundaries and must never be allowed to follow an unsafe
  // `.local` ancestor on behalf of SC-001.
  await ensurePrivateStorePath(cwd, dirname(storeTarget));
  return withSemanticContinuationAuthorityLease(cwd, () =>
    withMutation(storeTarget, async () => {
      await recoverOrphanedSemanticIntentWritesAcrossNamespaces(cwd);
      const read = await readSemanticContinuationIntentStore(
        cwd,
        input.installationSecret
      );
      if (read.status === "invalid") {
        throw new SemanticContinuationStoreError("STORE_INVALID");
      }
      const current =
        read.status === "available"
          ? read.value
          : createEmptySemanticContinuationIntentStore(
              input.confirmedAt,
              input.installationSecret
            );
      const supersededIds = new Set(
        current.decisions.flatMap((decision) =>
          decision.supersedesDecisionId === null
            ? []
            : [decision.supersedesDecisionId]
        )
      );
      const superseded = [...current.decisions]
        .reverse()
        .find(
          (decision) =>
            !supersededIds.has(decision.decisionId) &&
            decision.intent === confirmation.intent &&
            decision.workContextRef === confirmation.workContextRef
        ) ?? null;
      const decision = createSemanticContinuationIntentDecision({
        confirmation,
        target,
        registrySha256: input.registrySha256,
        confirmedAt: input.confirmedAt,
        supersedesDecisionId: superseded?.decisionId ?? null
      });
      const store = sealSemanticContinuationIntentStore(
        {
          contract: SEMANTIC_CONTINUATION_INTENT_STORE_CONTRACT,
          schemaVersion:
            SEMANTIC_CONTINUATION_INTENT_STORE_SCHEMA_VERSION,
          authKeyId: current.authKeyId,
          revision: current.revision + 1,
          updatedAt: input.confirmedAt,
          decisions: [...current.decisions, decision].sort(
            compareSemanticIntentDecisions
          )
        },
        input.installationSecret
      );
      await writePrivateJson(cwd, storeTarget, store);
      return { store, decision };
    })
  );
}

async function assertNoPendingSemanticIntentWrite(
  cwd: string,
  directory: string
): Promise<void> {
  const status = await inspectLocalPrivateDirectoryChain(cwd, directory);
  if (status === "missing") return;
  const filenames = await readdir(directory);
  for (const filename of filenames) {
    if (!INTENT_TEMP_PATTERN.test(filename)) continue;
    const handle = await inspectPrivateTemporaryFile(
      join(directory, filename)
    );
    await handle.close();
    throw new SemanticContinuationStoreError("STORE_INVALID");
  }
}

/**
 * Authorized POST-only recovery. The shared filesystem authority lease is
 * held, so a recognized temporary file cannot belong to a live SC mutator.
 */
async function recoverOrphanedSemanticIntentWrites(
  cwd: string,
  directory: string
): Promise<void> {
  const status = await inspectLocalPrivateDirectoryChain(cwd, directory);
  if (status === "missing") return;
  for (const filename of (await readdir(directory)).sort()) {
    if (!INTENT_TEMP_PATTERN.test(filename)) continue;
    const path = join(directory, filename);
    const handle = await inspectPrivateTemporaryFile(path);
    try {
      const pathMetadata = await lstat(path);
      const handleMetadata = await handle.stat();
      if (
        pathMetadata.isSymbolicLink() ||
        pathMetadata.dev !== handleMetadata.dev ||
        pathMetadata.ino !== handleMetadata.ino ||
        !privateFileMetadata(pathMetadata)
      ) {
        throw new SemanticContinuationStoreError("STORE_INVALID");
      }
      await unlink(path);
    } finally {
      await handle.close();
    }
  }
  await ensurePrivateStorePath(cwd, directory);
}

async function recoverOrphanedSemanticIntentWritesAcrossNamespaces(
  cwd: string
): Promise<void> {
  const root = semanticContinuationLocalRoot(cwd);
  const status = await inspectLocalPrivateDirectoryChain(cwd, root);
  if (status === "missing") return;

  // The fixed-root v0.1 location is quarantined rather than read, but a crash
  // may have left one of its exact temp files behind. Recover it under the
  // shared cross-process lease before visiting secret-scoped v0.2 stores.
  await recoverOrphanedSemanticIntentWrites(cwd, root);
  for (const filename of (await readdir(root)).sort()) {
    if (!semanticContinuationIntentAuthKeyIdSchema.safeParse(filename).success) {
      continue;
    }
    await recoverOrphanedSemanticIntentWrites(cwd, join(root, filename));
  }
}

async function inspectPrivateTemporaryFile(
  path: string
): Promise<FileHandle> {
  try {
    const handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const handleMetadata = await handle.stat();
    const pathMetadata = await lstat(path);
    if (
      !privateFileMetadata(handleMetadata) ||
      !privateFileMetadata(pathMetadata) ||
      pathMetadata.isSymbolicLink() ||
      handleMetadata.dev !== pathMetadata.dev ||
      handleMetadata.ino !== pathMetadata.ino
    ) {
      await handle.close();
      throw new SemanticContinuationStoreError("STORE_INVALID");
    }
    return handle;
  } catch (error) {
    if (error instanceof SemanticContinuationStoreError) throw error;
    throw new SemanticContinuationStoreError("STORE_INVALID");
  }
}

async function writePrivateJson(
  cwd: string,
  target: string,
  value: unknown
): Promise<void> {
  const directory = dirname(target);
  let temporary: string | null = null;
  let handle: FileHandle | null = null;
  try {
    await ensurePrivateStorePath(cwd, directory);
    const existing = await lstat(target).catch((error) => {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    });
    if (
      existing !== null &&
      (!privateFileMetadata(existing) || existing.isSymbolicLink())
    ) {
      throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
    }
    temporary = `${target}.${process.pid}.${randomBytes(8).toString(
      "hex"
    )}.tmp`;
    handle = await open(
      temporary,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    const temporaryMetadata = await handle.stat();
    if (!privateFileMetadata(temporaryMetadata)) {
      throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
    }
    await handle.close();
    handle = null;
    await ensurePrivateStorePath(cwd, directory);
    await rename(temporary, target);
    temporary = null;
    const installed = await lstat(target);
    if (!privateFileMetadata(installed) || installed.isSymbolicLink()) {
      throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
    }
    await syncDirectory(directory);
  } catch {
    await handle?.close().catch(() => undefined);
    if (temporary !== null) {
      try {
        await unlink(temporary);
      } catch {
        // Atomic rename may already have consumed the temporary file.
      }
    }
    throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
  }
}

async function ensurePrivateStorePath(
  cwd: string,
  directory: string
): Promise<void> {
  const root = resolve(cwd);
  const target = resolve(directory);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
  }
  const uid = process.geteuid?.() ?? process.getuid?.();
  const rootMetadata = await lstat(root);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (uid !== undefined && rootMetadata.uid !== uid)
  ) {
    throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
  }
  let current = root;
  for (const component of relativeTarget.split(/[\\/]+/u).filter(Boolean)) {
    current = join(current, component);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    const metadata = await lstat(current);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      (uid !== undefined && metadata.uid !== uid)
    ) {
      throw new SemanticContinuationStoreError("STORE_WRITE_FAILED");
    }
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

function withMutation<T>(
  key: string,
  mutation: () => Promise<T>
): Promise<T> {
  const normalized = resolve(key);
  const queues = sharedMutationQueues();
  const previous = queues.get(normalized) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  queues.set(normalized, next);
  return next.finally(() => {
    if (queues.get(normalized) === next) queues.delete(normalized);
  });
}

function sharedMutationQueues(): Map<string, Promise<unknown>> {
  const shared = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = shared[MUTATION_QUEUES];
  if (existing instanceof Map) {
    return existing as Map<string, Promise<unknown>>;
  }
  const created = new Map<string, Promise<unknown>>();
  shared[MUTATION_QUEUES] = created;
  return created;
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
