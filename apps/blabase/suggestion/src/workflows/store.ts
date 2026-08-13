import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText,
  type LocalReadMode
} from "../localReadMode";
import {
  PROJECT_WORKFLOW_FILENAME,
  PROJECT_WORKFLOW_GRACE_PERIOD_MS,
  PROJECT_WORKFLOW_POLICY_VERSION,
  PROJECT_WORKFLOW_SCHEMA_VERSION,
  PROJECT_WORKFLOW_STORE_CONTRACT,
  projectWorkflowActionKindSchema,
  projectWorkflowBindingIdSchema,
  projectWorkflowClosure,
  projectWorkflowClosureKey,
  projectWorkflowDecision,
  projectWorkflowDecisionIdSchema,
  projectWorkflowExecutionIdSchema,
  projectWorkflowManagedRunIdSchema,
  projectWorkflowProjectIdSchema,
  projectWorkflowStoreSchema,
  sealProjectWorkflowStore,
  type ProjectWorkflowActionKind,
  type ProjectWorkflowClosure,
  type ProjectWorkflowDecision,
  type ProjectWorkflowStore
} from "./contracts";

const EMPTY_STORE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const mutationQueues = new Map<string, Promise<unknown>>();

export class ProjectWorkflowStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
      | "EXPLICIT_USER_CONFIRMATION_REQUIRED"
      | "DECISION_TIME_REGRESSION"
      | "WORKFLOW_DECISION_NOT_FOUND"
      | "WORKFLOW_DECISION_NOT_CONFIGURED"
      | "CLOSURE_ALREADY_RECORDED"
      | "CLOSURE_IDENTITY_MISMATCH"
  ) {
    super(code);
    this.name = "ProjectWorkflowStoreError";
  }
}

export function createEmptyProjectWorkflowStore(
  updatedAt = EMPTY_STORE_TIMESTAMP
): ProjectWorkflowStore {
  return sealProjectWorkflowStore({
    contract: PROJECT_WORKFLOW_STORE_CONTRACT,
    schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
    policyVersion: PROJECT_WORKFLOW_POLICY_VERSION,
    revision: 0,
    updatedAt: new Date(updatedAt).toISOString(),
    decisions: [],
    closures: []
  });
}

export function currentProjectWorkflowDecision(
  storeInput: ProjectWorkflowStore,
  projectIdInput: string
): ProjectWorkflowDecision | null {
  const store = projectWorkflowStoreSchema.parse(storeInput);
  const projectId = projectWorkflowProjectIdSchema.parse(projectIdInput);
  let current: ProjectWorkflowDecision | null = null;
  for (const decision of store.decisions) {
    if (decision.projectId === projectId) current = decision;
  }
  return current;
}

export function configureProjectWorkflow(
  storeInput: ProjectWorkflowStore,
  input: {
    projectId: string;
    actionKind: ProjectWorkflowActionKind;
    configuredAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: ProjectWorkflowStore;
  decision: ProjectWorkflowDecision;
  changed: boolean;
} {
  assertExplicitUserConfirmation(input.explicitUserConfirmation);
  const store = projectWorkflowStoreSchema.parse(storeInput);
  const projectId = projectWorkflowProjectIdSchema.parse(input.projectId);
  const actionKind = projectWorkflowActionKindSchema.parse(input.actionKind);
  const configuredAt = assertDecisionTime(store, input.configuredAt);
  const current = currentProjectWorkflowDecision(store, projectId);
  if (
    current?.operation === "configure" &&
    current.actionKind === actionKind
  ) {
    return { store, decision: current, changed: false };
  }
  const decision = projectWorkflowDecision({
    sequence: store.revision + 1,
    operation: "configure",
    projectId,
    actionKind,
    configuredAt,
    decidedAt: configuredAt,
    decisionSource: "explicit_user",
    supersedesWorkflowDecisionId:
      current?.workflowDecisionId ?? null,
    gracePeriodMs: PROJECT_WORKFLOW_GRACE_PERIOD_MS
  });
  return {
    store: appendDecision(store, decision),
    decision,
    changed: true
  };
}

export function clearProjectWorkflow(
  storeInput: ProjectWorkflowStore,
  input: {
    projectId: string;
    clearedAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: ProjectWorkflowStore;
  decision: ProjectWorkflowDecision | null;
  changed: boolean;
} {
  assertExplicitUserConfirmation(input.explicitUserConfirmation);
  const store = projectWorkflowStoreSchema.parse(storeInput);
  const projectId = projectWorkflowProjectIdSchema.parse(input.projectId);
  const current = currentProjectWorkflowDecision(store, projectId);
  if (current === null || current.operation === "clear") {
    return { store, decision: current, changed: false };
  }
  const clearedAt = assertDecisionTime(store, input.clearedAt);
  const decision = projectWorkflowDecision({
    sequence: store.revision + 1,
    operation: "clear",
    projectId,
    actionKind: null,
    configuredAt: null,
    decidedAt: clearedAt,
    decisionSource: "explicit_user",
    supersedesWorkflowDecisionId: current.workflowDecisionId,
    gracePeriodMs: PROJECT_WORKFLOW_GRACE_PERIOD_MS
  });
  return {
    store: appendDecision(store, decision),
    decision,
    changed: true
  };
}

export function recordProjectWorkflowClosure(
  storeInput: ProjectWorkflowStore,
  input: {
    managedRunId: string;
    bindingId: string;
    executionId: string;
    workflowDecisionId: string;
    actionKind: ProjectWorkflowActionKind;
    outcome: "completed" | "skipped";
    decidedAt: string;
    explicitUserConfirmation: true;
  }
): {
  store: ProjectWorkflowStore;
  closure: ProjectWorkflowClosure;
  changed: boolean;
} {
  assertExplicitUserConfirmation(input.explicitUserConfirmation);
  const store = projectWorkflowStoreSchema.parse(storeInput);
  const managedRunId = projectWorkflowManagedRunIdSchema.parse(
    input.managedRunId
  );
  const bindingId = projectWorkflowBindingIdSchema.parse(input.bindingId);
  const executionId = projectWorkflowExecutionIdSchema.parse(
    input.executionId
  );
  const workflowDecisionId = projectWorkflowDecisionIdSchema.parse(
    input.workflowDecisionId
  );
  const actionKind = projectWorkflowActionKindSchema.parse(input.actionKind);
  const decision = store.decisions.find(
    (candidate) =>
      candidate.workflowDecisionId === workflowDecisionId
  );
  if (!decision) {
    throw new ProjectWorkflowStoreError(
      "WORKFLOW_DECISION_NOT_FOUND"
    );
  }
  if (
    decision.operation !== "configure" ||
    decision.actionKind !== actionKind ||
    decision.configuredAt === null
  ) {
    throw new ProjectWorkflowStoreError(
      "WORKFLOW_DECISION_NOT_CONFIGURED"
    );
  }
  const closureKey = projectWorkflowClosureKey({
    managedRunId,
    workflowDecisionId
  });
  const existing = store.closures.find(
    (closure) => projectWorkflowClosureKey(closure) === closureKey
  );
  if (existing) {
    if (
      existing.bindingId === bindingId &&
      existing.executionId === executionId &&
      existing.actionKind === actionKind &&
      existing.outcome === input.outcome
    ) {
      return { store, closure: existing, changed: false };
    }
    throw new ProjectWorkflowStoreError(
      existing.bindingId !== bindingId ||
        existing.executionId !== executionId ||
        existing.actionKind !== actionKind
        ? "CLOSURE_IDENTITY_MISMATCH"
        : "CLOSURE_ALREADY_RECORDED"
    );
  }
  const decidedAt = assertDecisionTime(store, input.decidedAt);
  if (Date.parse(decidedAt) < Date.parse(decision.configuredAt)) {
    throw new ProjectWorkflowStoreError("DECISION_TIME_REGRESSION");
  }
  const closure = projectWorkflowClosure({
    sequence: store.revision + 1,
    managedRunId,
    bindingId,
    executionId,
    workflowDecisionId,
    actionKind,
    outcome: input.outcome,
    decidedAt,
    decisionSource: "explicit_user"
  });
  return {
    store: appendClosure(store, closure),
    closure,
    changed: true
  };
}

export async function readProjectWorkflowStore(
  cwd = process.cwd(),
  mode: LocalReadMode = "maintain"
): Promise<ProjectWorkflowStore> {
  const target = projectWorkflowStorePath(cwd);
  if (mode === "preserve") {
    try {
      if (
        (await inspectLocalPrivateDirectoryChain(cwd, dirname(target))) ===
        "missing"
      ) {
        return createEmptyProjectWorkflowStore();
      }
      const raw = await readLocalPrivateText(target, mode, cwd);
      return projectWorkflowStoreSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return createEmptyProjectWorkflowStore();
      }
      if (error instanceof ProjectWorkflowStoreError) throw error;
      throw new ProjectWorkflowStoreError("STORE_INVALID");
    }
  }
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return createEmptyProjectWorkflowStore();
    }
    throw new ProjectWorkflowStoreError("STORE_READ_FAILED");
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new ProjectWorkflowStoreError("STORE_INVALID");
  }
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch {
    throw new ProjectWorkflowStoreError("STORE_READ_FAILED");
  }
  try {
    return projectWorkflowStoreSchema.parse(JSON.parse(raw));
  } catch {
    throw new ProjectWorkflowStoreError("STORE_INVALID");
  }
}

export async function writeProjectWorkflowStore(
  storeInput: ProjectWorkflowStore,
  cwd = process.cwd()
): Promise<void> {
  const store = projectWorkflowStoreSchema.parse(storeInput);
  const target = projectWorkflowStorePath(cwd);
  const directory = dirname(target);
  const serialized = `${JSON.stringify(store, null, 2)}\n`;
  let temporary: string | null = null;
  let renamed = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    temporary = `${target}.${process.pid}.${randomBytes(8).toString(
      "hex"
    )}.tmp`;
    await writeFile(temporary, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    renamed = true;
    await chmod(target, 0o600);
  } catch {
    if (renamed && (await isExactPrivateFile(target, serialized))) {
      return;
    }
    if (temporary) await unlink(temporary).catch(() => undefined);
    throw new ProjectWorkflowStoreError("STORE_WRITE_FAILED");
  }
}

export async function configureStoredProjectWorkflow(
  input: {
    projectId: string;
    actionKind: ProjectWorkflowActionKind;
    configuredAt: string;
    explicitUserConfirmation: true;
  },
  cwd = process.cwd()
): Promise<ReturnType<typeof configureProjectWorkflow>> {
  return mutateStoredWorkflow(cwd, async (store) =>
    configureProjectWorkflow(store, input)
  );
}

export async function clearStoredProjectWorkflow(
  input: {
    projectId: string;
    clearedAt: string;
    explicitUserConfirmation: true;
  },
  cwd = process.cwd()
): Promise<ReturnType<typeof clearProjectWorkflow>> {
  return mutateStoredWorkflow(cwd, async (store) =>
    clearProjectWorkflow(store, input)
  );
}

export async function recordStoredProjectWorkflowClosure(
  input: Parameters<typeof recordProjectWorkflowClosure>[1],
  cwd = process.cwd()
): Promise<ReturnType<typeof recordProjectWorkflowClosure>> {
  return mutateStoredWorkflow(cwd, async (store) =>
    recordProjectWorkflowClosure(store, input)
  );
}

export function projectWorkflowStorePath(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "context", PROJECT_WORKFLOW_FILENAME);
}

async function mutateStoredWorkflow<T extends {
  store: ProjectWorkflowStore;
  changed: boolean;
}>(
  cwd: string,
  mutation: (store: ProjectWorkflowStore) => Promise<T>
): Promise<T> {
  const key = projectWorkflowStorePath(cwd);
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const store = await readProjectWorkflowStore(cwd);
    const result = await mutation(store);
    if (result.changed) {
      await writeProjectWorkflowStore(result.store, cwd);
    }
    return result;
  });
  mutationQueues.set(key, next);
  return next.finally(() => {
    if (mutationQueues.get(key) === next) mutationQueues.delete(key);
  });
}

function appendDecision(
  store: ProjectWorkflowStore,
  decision: ProjectWorkflowDecision
): ProjectWorkflowStore {
  return sealProjectWorkflowStore({
    contract: PROJECT_WORKFLOW_STORE_CONTRACT,
    schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
    policyVersion: PROJECT_WORKFLOW_POLICY_VERSION,
    revision: store.revision + 1,
    updatedAt: decision.decidedAt,
    decisions: [...store.decisions, decision],
    closures: store.closures
  });
}

function appendClosure(
  store: ProjectWorkflowStore,
  closure: ProjectWorkflowClosure
): ProjectWorkflowStore {
  return sealProjectWorkflowStore({
    contract: PROJECT_WORKFLOW_STORE_CONTRACT,
    schemaVersion: PROJECT_WORKFLOW_SCHEMA_VERSION,
    policyVersion: PROJECT_WORKFLOW_POLICY_VERSION,
    revision: store.revision + 1,
    updatedAt: closure.decidedAt,
    decisions: store.decisions,
    closures: [...store.closures, closure]
  });
}

function assertDecisionTime(
  store: ProjectWorkflowStore,
  value: string
): string {
  const decidedAt = new Date(value).toISOString();
  if (Date.parse(decidedAt) < Date.parse(store.updatedAt)) {
    throw new ProjectWorkflowStoreError("DECISION_TIME_REGRESSION");
  }
  return decidedAt;
}

function assertExplicitUserConfirmation(value: true): void {
  if (value !== true) {
    throw new ProjectWorkflowStoreError(
      "EXPLICIT_USER_CONFIRMATION_REQUIRED"
    );
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

async function isExactPrivateFile(
  target: string,
  expected: string
): Promise<boolean> {
  try {
    const [actual, metadata] = await Promise.all([
      readFile(target, "utf8"),
      lstat(target)
    ]);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      (metadata.mode & 0o777) === 0o600 &&
      actual === expected
    );
  } catch {
    return false;
  }
}
