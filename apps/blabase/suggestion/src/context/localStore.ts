import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ZodType } from "zod";

import {
  captureWeeklyOutcome,
  confirmProjectMapping,
  correctWeeklyOutcome,
  createEmptyWeeklyOutcomeStore,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  proposeProjectMapping,
  removeProjectMapping,
  resolveWeeklyOutcome,
  type MappingDecision,
  type MappingProposal,
  type ProjectIdentity,
  type SourceScopeRef,
  type WeeklyOutcome,
  type WeeklyOutcomeStore,
  type WorkContextRegistry,
  weeklyOutcomeStoreSchema,
  workContextRegistrySchema
} from "./contracts";

const REGISTRY_FILENAME = "project-registry.json";
const OUTCOMES_FILENAME = "weekly-outcomes.json";
const mutationQueues = new Map<string, Promise<unknown>>();

export type StoreReadFailureReason =
  | "PARSE_FAILED"
  | "SCHEMA_INVALID"
  | "READ_FAILED";

export type StoreReadResult<T> =
  | { status: "available"; value: T }
  | { status: "missing" }
  | {
      status: "invalid";
      reason: StoreReadFailureReason;
    };

export type WeeklyOutcomeReadResult =
  | {
      status: "available";
      outcome: WeeklyOutcome;
    }
  | {
      status: "missing";
      reason:
        | "STORE_MISSING"
        | "OUTCOME_MISSING"
        | "NOT_YET_ACTIVE";
    }
  | {
      status: "expired";
      outcomeId: string;
      validUntil: string;
    }
  | {
      status: "invalid";
      reason: StoreReadFailureReason;
    };

export function workContextLocalDirectory(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "context");
}

export async function readWorkContextRegistry(
  cwd = process.cwd()
): Promise<StoreReadResult<WorkContextRegistry>> {
  return readPrivateStore(
    join(workContextLocalDirectory(cwd), REGISTRY_FILENAME),
    workContextRegistrySchema
  );
}

export async function readWeeklyOutcomeStore(
  cwd = process.cwd()
): Promise<StoreReadResult<WeeklyOutcomeStore>> {
  return readPrivateStore(
    join(workContextLocalDirectory(cwd), OUTCOMES_FILENAME),
    weeklyOutcomeStoreSchema
  );
}

/**
 * Reads the effective outcome without collapsing absent local state into a
 * malformed-store result. Callers can therefore fail closed while still
 * explaining whether no outcome was captured or persisted data was invalid.
 */
export async function readWeeklyOutcome(
  input: {
    asOf: string;
    projectId?: string;
  },
  cwd = process.cwd()
): Promise<WeeklyOutcomeReadResult> {
  const read = await readWeeklyOutcomeStore(cwd);
  if (read.status === "missing") {
    return { status: "missing", reason: "STORE_MISSING" };
  }
  if (read.status === "invalid") return read;
  const resolved = resolveWeeklyOutcome(read.value, input);
  if (resolved.status === "active") {
    return { status: "available", outcome: resolved.outcome };
  }
  return resolved;
}

export async function createStoredProjectIdentity(
  input: {
    createdAt: string;
    projectId?: string;
  },
  cwd = process.cwd()
): Promise<{
  registry: WorkContextRegistry;
  project: ProjectIdentity;
}> {
  return mutateRegistry(cwd, input.createdAt, (registry) =>
    createProjectIdentity(registry, input)
  );
}

export async function proposeStoredProjectMapping(
  input: {
    scope: SourceScopeRef;
    suggestedProjectId: string;
    proposedAt: string;
    basis:
      | "shared_opaque_identifier"
      | "source_metadata_hint"
      | "user_workflow_hint";
  },
  cwd = process.cwd()
): Promise<{
  registry: WorkContextRegistry;
  proposal: MappingProposal;
}> {
  return mutateRegistry(cwd, input.proposedAt, (registry) =>
    proposeProjectMapping(registry, input)
  );
}

export async function confirmStoredProjectMapping(
  input: {
    scope: SourceScopeRef;
    projectId: string;
    confirmedAt: string;
    explicitUserConfirmation: true;
  },
  cwd = process.cwd()
): Promise<{
  registry: WorkContextRegistry;
  decision: MappingDecision;
}> {
  return mutateRegistry(cwd, input.confirmedAt, (registry) =>
    confirmProjectMapping(registry, input)
  );
}

export async function removeStoredProjectMapping(
  input: {
    scope: SourceScopeRef;
    removedAt: string;
    explicitUserConfirmation: true;
  },
  cwd = process.cwd()
): Promise<{
  registry: WorkContextRegistry;
  decision: MappingDecision | null;
}> {
  return mutateRegistry(cwd, input.removedAt, (registry) =>
    removeProjectMapping(registry, input)
  );
}

export async function captureStoredWeeklyOutcome(
  input: {
    primaryOutcome: string;
    capturedAt: string;
    validUntil: string;
    recordedAt: string;
    projectId?: string;
  },
  cwd = process.cwd()
): Promise<{
  store: WeeklyOutcomeStore;
  outcome: WeeklyOutcome;
}> {
  return mutateOutcomeStore(cwd, input.recordedAt, (store) =>
    captureWeeklyOutcome(store, input)
  );
}

export async function correctStoredWeeklyOutcome(
  input: {
    targetOutcomeId: string;
    primaryOutcome: string;
    recordedAt: string;
  },
  cwd = process.cwd()
): Promise<{
  store: WeeklyOutcomeStore;
  outcome: WeeklyOutcome;
}> {
  return mutateOutcomeStore(cwd, input.recordedAt, (store) =>
    correctWeeklyOutcome(store, input)
  );
}

export class WorkContextStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
  ) {
    super(code);
    this.name = "WorkContextStoreError";
  }
}

async function mutateRegistry<T extends { registry: WorkContextRegistry }>(
  cwd: string,
  initialTimestamp: string,
  mutation: (registry: WorkContextRegistry) => T
): Promise<T> {
  const target = join(
    workContextLocalDirectory(cwd),
    REGISTRY_FILENAME
  );
  return withStoreMutation(target, async () => {
    const read = await readWorkContextRegistry(cwd);
    if (read.status === "invalid") {
      throw new WorkContextStoreError("STORE_INVALID");
    }
    const result = mutation(
      read.status === "available"
        ? read.value
        : createEmptyWorkContextRegistry(initialTimestamp)
    );
    await writePrivateJson(target, result.registry);
    return result;
  });
}

async function mutateOutcomeStore<
  T extends { store: WeeklyOutcomeStore }
>(
  cwd: string,
  initialTimestamp: string,
  mutation: (store: WeeklyOutcomeStore) => T
): Promise<T> {
  const target = join(
    workContextLocalDirectory(cwd),
    OUTCOMES_FILENAME
  );
  return withStoreMutation(target, async () => {
    const read = await readWeeklyOutcomeStore(cwd);
    if (read.status === "invalid") {
      throw new WorkContextStoreError("STORE_INVALID");
    }
    const result = mutation(
      read.status === "available"
        ? read.value
        : createEmptyWeeklyOutcomeStore(initialTimestamp)
    );
    await writePrivateJson(target, result.store);
    return result;
  });
}

async function readPrivateStore<T>(
  path: string,
  schema: ZodType<T>
): Promise<StoreReadResult<T>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
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
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { status: "available", value: parsed.data }
    : { status: "invalid", reason: "SCHEMA_INVALID" };
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
    await writeFile(
      temporary,
      `${JSON.stringify(value, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600
      }
    );
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch {
    if (temporary !== null) {
      try {
        await unlink(temporary);
      } catch {
        // The atomic rename may already have consumed the temp file.
      }
    }
    throw new WorkContextStoreError("STORE_WRITE_FAILED");
  }
}

function withStoreMutation<T>(
  key: string,
  mutation: () => Promise<T>
): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  mutationQueues.set(key, next);
  return next.finally(() => {
    if (mutationQueues.get(key) === next) mutationQueues.delete(key);
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
