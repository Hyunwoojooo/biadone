import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText,
  type LocalReadMode
} from "../localReadMode";

import {
  compareSemanticIntentDecisions,
  createEmptySemanticContinuationIntentStore,
  createSemanticContinuationIntentDecision,
  sealSemanticContinuationIntentStore,
  semanticContinuationConfirmationInputSchema,
  semanticContinuationConfirmationTargetSchema,
  semanticContinuationIntentStoreSchema,
  type SemanticContinuationConfirmationInput,
  type SemanticContinuationConfirmationTarget,
  type SemanticContinuationIntentDecision,
  type SemanticContinuationIntentStore
} from "./contracts";
import { withSemanticContinuationAuthorityLease } from "./validation/store";

const STORE_FILENAME = "intent-store.json";
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
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "semantic-continuation");
}

/** Pure read: invalid, missing, and expired state never rewrites the store. */
export async function readSemanticContinuationIntentStore(
  cwd = process.cwd(),
  mode: LocalReadMode = "maintain"
): Promise<SemanticContinuationStoreReadResult> {
  const target = join(
    semanticContinuationLocalDirectory(cwd),
    STORE_FILENAME
  );
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
    if (isNodeError(error, "ENOENT")) return { status: "missing" };
    return { status: "invalid", reason: "READ_FAILED" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "PARSE_FAILED" };
  }
  const parsed = semanticContinuationIntentStoreSchema.safeParse(value);
  return parsed.success
    ? { status: "available", value: parsed.data }
    : { status: "invalid", reason: "SCHEMA_INVALID" };
}

export async function confirmStoredSemanticContinuationIntent(
  input: {
    confirmation: SemanticContinuationConfirmationInput;
    target: SemanticContinuationConfirmationTarget;
    registrySha256: string;
    confirmedAt: string;
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
    semanticContinuationLocalDirectory(cwd),
    STORE_FILENAME
  );
  return withSemanticContinuationAuthorityLease(cwd, () =>
    withMutation(storeTarget, async () => {
      const read = await readSemanticContinuationIntentStore(cwd);
      if (read.status === "invalid") {
        throw new SemanticContinuationStoreError("STORE_INVALID");
      }
      const current =
        read.status === "available"
          ? read.value
          : createEmptySemanticContinuationIntentStore(input.confirmedAt);
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
      const store = sealSemanticContinuationIntentStore({
        contract: current.contract,
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1,
        updatedAt: input.confirmedAt,
        decisions: [...current.decisions, decision].sort(
          compareSemanticIntentDecisions
        )
      });
      await writePrivateJson(storeTarget, store);
      return { store, decision };
    })
  );
}

async function writePrivateJson(
  target: string,
  value: unknown
): Promise<void> {
  const directory = dirname(target);
  let temporary: string | null = null;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    temporary = `${target}.${process.pid}.${randomBytes(8).toString(
      "hex"
    )}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch {
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
