import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ZodType } from "zod";

import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../connectors/codex/localStore";
import {
  bindWorkSessionDecision,
  claimWorkResumptionCommand,
  completeClaimedCommandInputSchema,
  completeWorkResumptionCommand,
  createEmptyWorkSessionBindingStore,
  createPendingWorkResumptionCommand,
  createWorkResumptionHeartbeat,
  currentWorkSessionBindings,
  currentStoredWorkSessionBindings,
  expireWorkResumptionCommand,
  isFreshWorkResumptionHeartbeat,
  lookupWorkSessionBinding,
  lookupStoredWorkSessionBinding,
  publicCommandStatus,
  startWorkResumptionCommandLaunch,
  unbindWorkSessionDecision,
  WORK_RESUMPTION_COMMAND_RETENTION_DAYS,
  workResumptionCommandIdSchema,
  workResumptionCommandSchema,
  workResumptionExecutionIdSchema,
  workResumptionHeartbeatSchema,
  workResumptionInstanceIdSchema,
  workResumptionTaskRefSchema,
  workResumptionCodexConnectionGeneration,
  workSessionBindingStoreSchema,
  type CompleteClaimedCommandInput,
  type PublicWorkResumptionCommandStatus,
  type WorkResumptionCommand,
  type WorkResumptionTaskRef,
  type WorkSessionBinding,
  type WorkSessionBindingStore,
  type WorkResumptionHeartbeat
} from "./contracts";

const BINDINGS_FILENAME = "bindings.json";
const HEARTBEAT_FILENAME = "heartbeat.json";
const COMMANDS_DIRECTORY = "commands";
const LOCKS_DIRECTORY = "locks";
const STATE_LOCK_NAME = "state";
const HEARTBEAT_LOCK_NAME = "heartbeat";
const FILESYSTEM_LOCK_STALE_MS = 30_000;
const FILESYSTEM_LOCK_WAIT_MS = 35_000;
const FILESYSTEM_LOCK_RETRY_MS = 20;
const commandFilePattern = /^command_[a-f0-9]{32}\.json$/;
const mutationQueues = new Map<string, Promise<unknown>>();

type PrivateReadResult<T> =
  | { status: "available"; value: T }
  | { status: "missing" }
  | { status: "invalid" };

export type WorkResumptionCompanionStatus = {
  state: "online" | "offline";
  lastSeenAt: string | null;
};

export type WorkResumptionStatus = {
  companion: WorkResumptionCompanionStatus;
  bindings: WorkSessionBinding[];
};

export class WorkResumptionStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
      | "BINDING_NOT_FOUND"
      | "COMPANION_OFFLINE"
      | "COMMAND_NOT_FOUND"
      | "COMMAND_CLAIM_MISMATCH"
      | "CODEX_EXECUTION_NOT_FOUND"
      | "CODEX_CONNECTION_UNAVAILABLE"
      | "COMPANION_ALREADY_RUNNING"
      | "LOCK_ACQUISITION_FAILED"
  ) {
    super(code);
    this.name = "WorkResumptionStoreError";
  }
}

export function workResumptionLocalDirectory(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "work-resumption");
}

export async function readWorkSessionBindingStore(
  cwd = process.cwd(),
  initialTimestamp = new Date().toISOString()
): Promise<WorkSessionBindingStore> {
  const read = await readPrivateJson(
    join(workResumptionLocalDirectory(cwd), BINDINGS_FILENAME),
    workSessionBindingStoreSchema
  );
  if (read.status === "available") return read.value;
  if (read.status === "missing") {
    return createEmptyWorkSessionBindingStore(initialTimestamp);
  }
  throw new WorkResumptionStoreError("STORE_INVALID");
}

export async function resolveStoredCodexExecutionScopeId(
  executionId: string,
  cwd = process.cwd()
): Promise<string> {
  const parsedExecutionId =
    workResumptionExecutionIdSchema.parse(executionId);
  const opaqueExecutionId = parsedExecutionId.slice(
    "codex:execution:".length
  );
  const snapshot = await readStoredCodexSnapshot(cwd);
  const session = snapshot?.sessions.find(
    (candidate) => candidate.id === opaqueExecutionId
  );
  if (!session) {
    throw new WorkResumptionStoreError(
      "CODEX_EXECUTION_NOT_FOUND"
    );
  }
  return session.scopeId;
}

export async function bindWorkSession(
  input: {
    taskRef: WorkResumptionTaskRef;
    executionId: string;
    explicitUserConfirmation: true;
    boundAt?: string;
  },
  cwd = process.cwd(),
  now = new Date()
): Promise<WorkSessionBinding> {
  const decidedAt = input.boundAt ?? now.toISOString();
  return withWorkResumptionMutation(cwd, async () => {
    const [scopeId] = await Promise.all([
      resolveStoredCodexExecutionScopeId(input.executionId, cwd),
      currentCodexConnectionGeneration(cwd)
    ]);
    const store = await readWorkSessionBindingStore(cwd, decidedAt);
    const previous = lookupWorkSessionBinding(store, input.taskRef);
    const result = bindWorkSessionDecision(store, {
      taskRef: input.taskRef,
      executionId: input.executionId,
      scopeId,
      boundAt: decidedAt,
      explicitUserConfirmation: input.explicitUserConfirmation
    });
    if (result.store.revision !== store.revision) {
      await writeBindingStore(result.store, cwd);
    }
    if (
      previous &&
      previous.bindingId !== result.binding.bindingId
    ) {
      await removeNonterminalCommandsForBinding(
        previous.bindingId,
        cwd
      );
    }
    const binding = lookupWorkSessionBinding(
      result.store,
      input.taskRef
    );
    if (!binding) {
      throw new WorkResumptionStoreError("STORE_INVALID");
    }
    return binding;
  });
}

export async function unbindWorkSession(
  input: {
    taskRef: WorkResumptionTaskRef;
    explicitUserConfirmation: true;
    unboundAt?: string;
  },
  cwd = process.cwd(),
  now = new Date()
): Promise<boolean> {
  const decidedAt = input.unboundAt ?? now.toISOString();
  return withWorkResumptionMutation(cwd, async () => {
    const store = await readWorkSessionBindingStore(cwd, decidedAt);
    const previous = lookupWorkSessionBinding(store, input.taskRef);
    const result = unbindWorkSessionDecision(store, {
      taskRef: input.taskRef,
      unboundAt: decidedAt,
      explicitUserConfirmation: input.explicitUserConfirmation
    });
    if (!result.decision) return false;
    await writeBindingStore(result.store, cwd);
    if (previous) {
      await removeNonterminalCommandsForBinding(
        previous.bindingId,
        cwd
      );
    }
    return true;
  });
}

export async function openWorkSession(
  input: {
    taskRef: WorkResumptionTaskRef;
    explicitUserAction: true;
  },
  cwd = process.cwd(),
  now = new Date()
): Promise<PublicWorkResumptionCommandStatus> {
  if (input.explicitUserAction !== true) {
    throw new WorkResumptionStoreError("BINDING_NOT_FOUND");
  }
  const taskRef = workResumptionTaskRefSchema.parse(input.taskRef);
  return withWorkResumptionMutation(cwd, async () => {
    const heartbeat = await readHeartbeat(cwd);
    if (
      !heartbeat ||
      !isFreshWorkResumptionHeartbeat(heartbeat, now)
    ) {
      throw new WorkResumptionStoreError("COMPANION_OFFLINE");
    }
    const store = await readWorkSessionBindingStore(
      cwd,
      now.toISOString()
    );
    const binding = lookupStoredWorkSessionBinding(store, taskRef);
    if (!binding) {
      throw new WorkResumptionStoreError("BINDING_NOT_FOUND");
    }

    const existing = await findNonterminalCommandForBinding(
      binding.bindingId,
      cwd,
      now
    );
    if (existing) return publicCommandStatus(existing);

    const command = createPendingWorkResumptionCommand({
      binding,
      connectionGeneration:
        await currentCodexConnectionGeneration(cwd),
      createdAt: now.toISOString()
    });
    await writeCommand(command, cwd);
    return publicCommandStatus(command);
  });
}

export async function readWorkResumptionStatus(
  cwd = process.cwd(),
  now = new Date()
): Promise<WorkResumptionStatus> {
  await withWorkResumptionMutation(cwd, () =>
    pruneTerminalCommandFiles(cwd, now)
  );
  const [store, heartbeat] = await Promise.all([
    readWorkSessionBindingStore(cwd, now.toISOString()),
    readHeartbeat(cwd)
  ]);
  return {
    companion: {
      state:
        heartbeat &&
        isFreshWorkResumptionHeartbeat(heartbeat, now)
          ? "online"
          : "offline",
      lastSeenAt: heartbeat?.observedAt ?? null
    },
    bindings: currentWorkSessionBindings(store)
  };
}

export async function readWorkResumptionCommandStatus(
  commandIdInput: string,
  cwd = process.cwd(),
  now = new Date()
): Promise<PublicWorkResumptionCommandStatus | null> {
  const commandId =
    workResumptionCommandIdSchema.parse(commandIdInput);
  return withWorkResumptionMutation(cwd, async () => {
    const command = await readCommand(commandId, cwd);
    if (!command) return null;
    if (isPastCommandRetention(command, now)) {
      await unlink(commandPath(command.commandId, cwd)).catch(
        (error) => {
          if (!isNodeError(error, "ENOENT")) throw error;
        }
      );
      return null;
    }
    const current = expireWorkResumptionCommand(
      command,
      now.toISOString()
    );
    if (current.status !== command.status) {
      await writeCommand(current, cwd);
    }
    return publicCommandStatus(current);
  });
}

export async function writeCompanionHeartbeat(
  cwd: string,
  now: Date,
  instanceId: string
): Promise<void> {
  const heartbeat = createWorkResumptionHeartbeat(
    now.toISOString(),
    workResumptionInstanceIdSchema.parse(instanceId)
  );
  await withNamedFilesystemLock(
    cwd,
    HEARTBEAT_LOCK_NAME,
    async () => {
      const current = await readHeartbeat(cwd);
      if (
        current &&
        current.instanceId !== heartbeat.instanceId &&
        isFreshWorkResumptionHeartbeat(current, now)
      ) {
        throw new WorkResumptionStoreError(
          "COMPANION_ALREADY_RUNNING"
        );
      }
      await writePrivateJson(
        join(
          workResumptionLocalDirectory(cwd),
          HEARTBEAT_FILENAME
        ),
        heartbeat
      );
    }
  );
}

export async function clearCompanionHeartbeat(
  cwd: string,
  instanceId: string
): Promise<boolean> {
  return withNamedFilesystemLock(
    cwd,
    HEARTBEAT_LOCK_NAME,
    async () => {
      const heartbeat = await readHeartbeat(cwd);
      if (
        !heartbeat ||
        heartbeat.instanceId !==
          workResumptionInstanceIdSchema.parse(instanceId)
      ) {
        return false;
      }
    await unlink(
      join(
        workResumptionLocalDirectory(cwd),
        HEARTBEAT_FILENAME
      )
    ).catch((error) => {
      if (!isNodeError(error, "ENOENT")) {
        throw new WorkResumptionStoreError(
          "STORE_WRITE_FAILED"
        );
      }
    });
      return true;
    }
  );
}

export async function claimNextPendingCommand(
  cwd = process.cwd(),
  now = new Date()
): Promise<WorkResumptionCommand | null> {
  return withWorkResumptionMutation(cwd, async () => {
    const commands = await readAllCommands(cwd, now);
    for (const command of commands) {
      if (command.status !== "pending") continue;
      const current = expireWorkResumptionCommand(
        command,
        now.toISOString()
      );
      if (current.status !== command.status) {
        await writeCommand(current, cwd);
        continue;
      }
      const latest = await readCommand(command.commandId, cwd);
      if (!latest || latest.status !== "pending") continue;
      const claimed = claimWorkResumptionCommand(
        latest,
        now.toISOString()
      );
      await writeCommand(claimed, cwd);
      if (claimed.status === "claimed") return claimed;
    }
    return null;
  });
}

export async function completeClaimedCommand(
  input: CompleteClaimedCommandInput,
  cwd = process.cwd()
): Promise<WorkResumptionCommand> {
  const completion = completeClaimedCommandInputSchema.parse(input);
  return withWorkResumptionMutation(cwd, async () => {
    const command = await readCommand(completion.commandId, cwd);
    if (!command) {
      throw new WorkResumptionStoreError("COMMAND_NOT_FOUND");
    }
    let completed: WorkResumptionCommand;
    try {
      completed = completeWorkResumptionCommand(
        command,
        completion
      );
    } catch {
      throw new WorkResumptionStoreError(
        "COMMAND_CLAIM_MISMATCH"
      );
    }
    await writeCommand(completed, cwd);
    return completed;
  });
}

export async function isClaimedCommandCurrent(
  input: {
    commandId: string;
    bindingId: string;
    claimToken: string;
  },
  cwd = process.cwd()
): Promise<boolean> {
  let commandId: string;
  try {
    commandId = workResumptionCommandIdSchema.parse(
      input.commandId
    );
  } catch {
    return false;
  }
  return withWorkResumptionMutation(cwd, async () => {
    const [command, store, connectionGeneration] =
      await Promise.all([
      readCommand(commandId, cwd).catch(() => null),
      readWorkSessionBindingStore(cwd).catch(() => null),
      currentCodexConnectionGeneration(cwd).catch(() => null)
    ]);
    if (
      !command ||
      !store ||
      command.status !== "claimed" ||
      command.bindingId !== input.bindingId ||
      command.claimToken !== input.claimToken ||
      command.launchStartedAt !== null ||
      command.connectionGeneration !== connectionGeneration
    ) {
      return false;
    }
    return currentStoredWorkSessionBindings(store).some(
      (binding) => binding.bindingId === command.bindingId
    );
  });
}

export type ClaimedCommandLaunchResult =
  | { state: "not_current" }
  | { state: "expired"; command: WorkResumptionCommand }
  | { state: "completed"; command: WorkResumptionCommand };

/**
 * The global state lease is intentionally held through the launcher callback.
 * Disconnect/unbind/status expiry therefore linearize either before the final
 * validation (no launch) or after the callback and terminal write.
 */
export async function runClaimedCommandWithLaunchLease(
  input: {
    commandId: string;
    bindingId: string;
    claimToken: string;
    launchStartedAt: string;
  },
  launch: () => Promise<CompleteClaimedCommandInput>,
  cwd = process.cwd()
): Promise<ClaimedCommandLaunchResult> {
  const commandId = workResumptionCommandIdSchema.parse(
    input.commandId
  );
  return withWorkResumptionMutation(cwd, async () => {
    const command = await readCommand(commandId, cwd);
    if (
      !command ||
      command.status !== "claimed" ||
      command.bindingId !== input.bindingId ||
      command.claimToken !== input.claimToken ||
      command.launchStartedAt !== null
    ) {
      return { state: "not_current" };
    }

    const expired = expireWorkResumptionCommand(
      command,
      input.launchStartedAt
    );
    if (expired.status === "expired") {
      await writeCommand(expired, cwd);
      return { state: "expired", command: expired };
    }

    const [store, connectionGeneration] = await Promise.all([
      readWorkSessionBindingStore(cwd).catch(() => null),
      currentCodexConnectionGeneration(cwd).catch(() => null)
    ]);
    if (
      !store ||
      connectionGeneration !== command.connectionGeneration ||
      !currentStoredWorkSessionBindings(store).some(
        (binding) => binding.bindingId === command.bindingId
      )
    ) {
      return { state: "not_current" };
    }

    const launching = startWorkResumptionCommandLaunch(command, {
      claimToken: input.claimToken,
      launchStartedAt: input.launchStartedAt
    });
    await writeCommand(launching, cwd);
    const completion = completeClaimedCommandInputSchema.parse(
      await launch()
    );
    if (
      completion.commandId !== command.commandId ||
      completion.claimToken !== command.claimToken
    ) {
      throw new WorkResumptionStoreError(
        "COMMAND_CLAIM_MISMATCH"
      );
    }
    const completed = completeWorkResumptionCommand(
      launching,
      completion
    );
    await writeCommand(completed, cwd);
    return { state: "completed", command: completed };
  });
}

/**
 * Explicit Codex disconnect cleanup. The heartbeat is intentionally retained:
 * it describes the companion process, while every resumable relationship and
 * queued/result command is removed.
 */
export async function clearWorkResumptionState(
  cwd = process.cwd()
): Promise<void> {
  await withWorkResumptionMutation(cwd, () =>
    clearWorkResumptionFiles(cwd)
  );
}

/**
 * Keeps connector deletion and Work Resumption cleanup in the same
 * cross-process state lease. A bind/open request can therefore linearize only
 * before the disconnect starts or after the Codex connection is gone.
 */
export async function clearWorkResumptionStateForCodexDisconnect(
  disconnectCodex: () => Promise<void>,
  cwd = process.cwd()
): Promise<void> {
  await withWorkResumptionMutation(cwd, async () => {
    await clearWorkResumptionFiles(cwd);
    await disconnectCodex();
    await clearWorkResumptionFiles(cwd);
  });
}

async function clearWorkResumptionFiles(cwd: string): Promise<void> {
  const directory = workResumptionLocalDirectory(cwd);
  await Promise.all([
    unlink(join(directory, BINDINGS_FILENAME)).catch((error) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    }),
    rm(join(directory, COMMANDS_DIRECTORY), {
      recursive: true,
      force: true
    })
  ]);
}

async function writeBindingStore(
  store: WorkSessionBindingStore,
  cwd: string
): Promise<void> {
  await writePrivateJson(
    join(workResumptionLocalDirectory(cwd), BINDINGS_FILENAME),
    workSessionBindingStoreSchema.parse(store)
  );
}

async function readHeartbeat(cwd: string) {
  const read = await readPrivateJson(
    join(workResumptionLocalDirectory(cwd), HEARTBEAT_FILENAME),
    workResumptionHeartbeatSchema
  );
  return read.status === "available" ? read.value : null;
}

async function currentCodexConnectionGeneration(
  cwd: string
): Promise<string> {
  const config = await readStoredCodexConfig(cwd);
  if (!config) {
    throw new WorkResumptionStoreError(
      "CODEX_CONNECTION_UNAVAILABLE"
    );
  }
  return workResumptionCodexConnectionGeneration({
    installationSecret: config.installationSecret,
    discoveredAt: config.discoveredAt
  });
}

async function readCommand(
  commandId: string,
  cwd: string
): Promise<WorkResumptionCommand | null> {
  const read = await readPrivateJson(
    commandPath(commandId, cwd),
    workResumptionCommandSchema
  );
  if (read.status === "available") return read.value;
  if (read.status === "missing") return null;
  throw new WorkResumptionStoreError("STORE_INVALID");
}

async function readAllCommands(
  cwd: string,
  now = new Date()
): Promise<WorkResumptionCommand[]> {
  const directory = commandDirectory(cwd);
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw new WorkResumptionStoreError("STORE_READ_FAILED");
  }
  const commands: WorkResumptionCommand[] = [];
  for (const file of files.sort()) {
    if (!commandFilePattern.test(file)) continue;
    const commandId = file.slice(0, -".json".length);
    const command = await readCommand(commandId, cwd);
    if (command && isPastCommandRetention(command, now)) {
      await unlink(commandPath(command.commandId, cwd)).catch(
        (error) => {
          if (!isNodeError(error, "ENOENT")) throw error;
        }
      );
    } else if (command) {
      commands.push(command);
    }
  }
  return commands.sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.commandId.localeCompare(right.commandId)
  );
}

async function pruneTerminalCommandFiles(
  cwd: string,
  now: Date
): Promise<void> {
  await readAllCommands(cwd, now);
}

function isPastCommandRetention(
  command: WorkResumptionCommand,
  now: Date
): boolean {
  if (
    command.status === "pending" ||
    command.status === "claimed" ||
    command.completedAt === null
  ) {
    return false;
  }
  const cutoff =
    now.getTime() -
    WORK_RESUMPTION_COMMAND_RETENTION_DAYS *
      24 *
      60 *
      60 *
      1_000;
  return Date.parse(command.completedAt) < cutoff;
}

async function findNonterminalCommandForBinding(
  bindingId: string,
  cwd: string,
  now: Date
): Promise<WorkResumptionCommand | null> {
  for (const command of await readAllCommands(cwd, now)) {
    if (command.bindingId !== bindingId) continue;
    const current = expireWorkResumptionCommand(
      command,
      now.toISOString()
    );
    if (current.status !== command.status) {
      await writeCommand(current, cwd);
    }
    if (
      current.status === "pending" ||
      current.status === "claimed"
    ) {
      return current;
    }
  }
  return null;
}

async function removeNonterminalCommandsForBinding(
  bindingId: string,
  cwd: string
): Promise<void> {
  for (const command of await readAllCommands(cwd)) {
    if (
      command.bindingId === bindingId &&
      (command.status === "pending" ||
        command.status === "claimed")
    ) {
      await unlink(commandPath(command.commandId, cwd)).catch(
        (error) => {
          if (!isNodeError(error, "ENOENT")) throw error;
        }
      );
    }
  }
}

async function writeCommand(
  command: WorkResumptionCommand,
  cwd: string
): Promise<void> {
  await writePrivateJson(
    commandPath(command.commandId, cwd),
    workResumptionCommandSchema.parse(command)
  );
}

function commandDirectory(cwd: string): string {
  return join(
    workResumptionLocalDirectory(cwd),
    COMMANDS_DIRECTORY
  );
}

function commandPath(commandId: string, cwd: string): string {
  return join(
    commandDirectory(cwd),
    `${workResumptionCommandIdSchema.parse(commandId)}.json`
  );
}

async function readPrivateJson<T>(
  path: string,
  schema: ZodType<T>
): Promise<PrivateReadResult<T>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { status: "missing" };
    throw new WorkResumptionStoreError("STORE_READ_FAILED");
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success
      ? { status: "available", value: parsed.data }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

async function writePrivateJson(
  target: string,
  value: unknown
): Promise<void> {
  const directory = dirname(target);
  let temporary: string | null = null;
  try {
    await ensurePrivateDirectory(directory);
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
    if (temporary) {
      await unlink(temporary).catch(() => undefined);
    }
    throw new WorkResumptionStoreError("STORE_WRITE_FAILED");
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    const parent = dirname(path);
    if (
      parent.endsWith(".local") ||
      parent.endsWith("work-resumption") ||
      parent.endsWith("commands")
    ) {
      await chmod(parent, 0o700).catch(() => undefined);
    }
  } catch {
    throw new WorkResumptionStoreError("STORE_WRITE_FAILED");
  }
}

function withWorkResumptionMutation<T>(
  cwd: string,
  mutation: () => Promise<T>
): Promise<T> {
  return withNamedFilesystemLock(cwd, STATE_LOCK_NAME, mutation);
}

function withNamedFilesystemLock<T>(
  cwd: string,
  name: typeof STATE_LOCK_NAME | typeof HEARTBEAT_LOCK_NAME,
  mutation: () => Promise<T>
): Promise<T> {
  const key = `${workResumptionLocalDirectory(cwd)}:${name}`;
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const lease = await acquireFilesystemLock(cwd, name);
      try {
        return await mutation();
      } finally {
        await releaseFilesystemLock(lease);
      }
    });
  mutationQueues.set(key, next);
  return next.finally(() => {
    if (mutationQueues.get(key) === next) mutationQueues.delete(key);
  });
}

type FilesystemLease = {
  path: string;
  token: string;
};

async function acquireFilesystemLock(
  cwd: string,
  name: typeof STATE_LOCK_NAME | typeof HEARTBEAT_LOCK_NAME
): Promise<FilesystemLease> {
  const directory = join(
    workResumptionLocalDirectory(cwd),
    LOCKS_DIRECTORY
  );
  await ensurePrivateDirectory(directory);
  const path = join(directory, `${name}.lock`);
  const deadline = Date.now() + FILESYSTEM_LOCK_WAIT_MS;

  while (Date.now() <= deadline) {
    const token = randomBytes(16).toString("hex");
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${token}\n`, "utf8");
      await handle.close();
      await chmod(path, 0o600);
      return { path, token };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!isNodeError(error, "EEXIST")) {
        await unlink(path).catch(() => undefined);
        throw new WorkResumptionStoreError(
          "LOCK_ACQUISITION_FAILED"
        );
      }
      await removeStaleFilesystemLock(path);
      await waitForFilesystemLock();
    }
  }
  throw new WorkResumptionStoreError(
    "LOCK_ACQUISITION_FAILED"
  );
}

async function removeStaleFilesystemLock(path: string): Promise<void> {
  try {
    const metadata = await stat(path);
    if (
      Date.now() - metadata.mtimeMs >
      FILESYSTEM_LOCK_STALE_MS
    ) {
      await unlink(path);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw new WorkResumptionStoreError(
        "LOCK_ACQUISITION_FAILED"
      );
    }
  }
}

async function releaseFilesystemLock(
  lease: FilesystemLease
): Promise<void> {
  try {
    const token = (await readFile(lease.path, "utf8")).trim();
    if (token === lease.token) {
      await unlink(lease.path);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw new WorkResumptionStoreError(
        "LOCK_ACQUISITION_FAILED"
      );
    }
  }
}

function waitForFilesystemLock(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FILESYSTEM_LOCK_RETRY_MS);
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
