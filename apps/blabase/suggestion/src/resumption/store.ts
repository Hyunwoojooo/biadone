import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ZodType } from "zod";

import {
  WORK_ARTIFACT_ATTRIBUTIONS_FILENAME,
  isWorkArtifactAttributionTempFilename
} from "../artifacts/contracts";
import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../connectors/codex/localStore";
import type { StoredCodexConfig } from "../connectors/codex/types";
import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText
} from "../localReadMode";
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
const FILESYSTEM_LOCK_RENEW_MS = 5_000;
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

export type ManagedCodexAuthoritySnapshot = {
  activeOwnerInstanceId: string | null;
  activeOwnerships: Array<{
    bindingId: string;
    executionId: string;
    scopeId: string;
    connectionGeneration: string;
  }>;
};

export type PreservedManagedCodexAuthoritySnapshot = {
  asOf: string;
  now: Date;
  authority: ManagedCodexAuthoritySnapshot;
  bindingStore: WorkSessionBindingStore;
  codexConfig: StoredCodexConfig | null;
};

type PreservedPrivateJsonRead<T> = PrivateReadResult<T> & {
  fingerprint: PreservedFileFingerprint | null;
};

type PreservedFileFingerprint = {
  device: number;
  inode: number;
  mode: number;
  ownerUid: number;
  ownerGid: number;
  linkCount: number;
  size: number;
  modifiedAtMs: number;
  changedAtMs: number;
};

export class WorkResumptionStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
      | "BINDING_NOT_FOUND"
      | "BINDING_IDENTITY_CHANGED"
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
      readCurrentCodexConnectionGeneration(cwd)
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
    expectedBindingId?: string;
    expectedExecutionId?: string;
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
    if (
      (input.expectedBindingId !== undefined ||
        input.expectedExecutionId !== undefined) &&
      (binding.bindingId !== input.expectedBindingId ||
        binding.executionId !== input.expectedExecutionId)
    ) {
      throw new WorkResumptionStoreError(
        "BINDING_IDENTITY_CHANGED"
      );
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
        await readCurrentCodexConnectionGeneration(cwd),
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
      readCurrentCodexConnectionGeneration(cwd).catch(() => null)
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
      (binding) => bindingMatchesCommand(binding, command)
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
      readCurrentCodexConnectionGeneration(cwd).catch(() => null)
    ]);
    if (
      !store ||
      connectionGeneration !== command.connectionGeneration ||
      !currentStoredWorkSessionBindings(store).some(
        (binding) => bindingMatchesCommand(binding, command)
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
  const artifactTempFiles = await readdir(directory).catch((error) => {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  });
  await Promise.all([
    unlink(join(directory, BINDINGS_FILENAME)).catch((error) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    }),
    unlink(join(directory, WORK_ARTIFACT_ATTRIBUTIONS_FILENAME)).catch(
      (error) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    ),
    rm(join(directory, COMMANDS_DIRECTORY), {
      recursive: true,
      force: true
    }),
    ...artifactTempFiles
      .filter(isWorkArtifactAttributionTempFilename)
      .map((filename) =>
        unlink(join(directory, filename)).catch((error) => {
          if (!isNodeError(error, "ENOENT")) throw error;
        })
      )
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

export async function readCurrentCodexConnectionGeneration(
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

export async function isManagedCodexOwnershipCurrent(
  input: {
    bindingId: string;
    executionId: string;
    scopeId: string;
    connectionGeneration: string;
  },
  cwd = process.cwd()
): Promise<boolean> {
  try {
    const [store, connectionGeneration] = await Promise.all([
      readWorkSessionBindingStore(cwd),
      readCurrentCodexConnectionGeneration(cwd)
    ]);
    if (connectionGeneration !== input.connectionGeneration) {
      return false;
    }
    return currentStoredWorkSessionBindings(store).some(
      (binding) =>
        binding.bindingId === input.bindingId &&
        binding.executionId === input.executionId &&
        binding.scopeId === input.scopeId
    );
  } catch {
    return false;
  }
}

/**
 * Reads the Companion owner and exact managed binding identities while the
 * Work Resumption state lease remains held through the caller's projection
 * read. This preserves the global state -> managed-store lock order and keeps
 * an unbound or disconnected run from being projected as live.
 */
export async function withManagedCodexAuthorityLease<T>(
  cwd: string,
  leaseTime: Date | (() => Date),
  read: (
    authority: ManagedCodexAuthoritySnapshot,
    leaseNow: Date
  ) => Promise<T>
): Promise<T> {
  return withWorkResumptionMutation(cwd, async () => {
    // A caller may wait behind a launch, bind, or disconnect. Capture time
    // only after that wait so freshness and append-only decisions share the
    // exact authority snapshot protected by this lease.
    const now =
      typeof leaseTime === "function" ? leaseTime() : leaseTime;
    const [store, heartbeat] = await Promise.all([
      readWorkSessionBindingStore(cwd, now.toISOString()),
      readHeartbeat(cwd)
    ]);
    const connectionGeneration = await readCurrentCodexConnectionGeneration(
      cwd
    ).catch(() => null);
    const authority: ManagedCodexAuthoritySnapshot = {
      activeOwnerInstanceId:
        heartbeat && isFreshWorkResumptionHeartbeat(heartbeat, now)
          ? heartbeat.instanceId
          : null,
      activeOwnerships:
        connectionGeneration === null
          ? []
          : currentStoredWorkSessionBindings(store).map((binding) => ({
              bindingId: binding.bindingId,
              executionId: binding.executionId,
              scopeId: binding.scopeId,
              connectionGeneration
            }))
    };
    return read(authority, now);
  });
}

/**
 * Captures Work Resumption authority without entering either mutation queue or
 * creating a filesystem lease. The caller supplies the preserve-read Codex
 * config so connection authority and projection-key authority cannot diverge.
 * Outer preserve capture validates the complete local manifest before/after.
 */
export async function withManagedCodexAuthoritySnapshotPreservingState<T>(
  cwd: string,
  nowInput: Date,
  codexConfig: StoredCodexConfig | null,
  read: (
    snapshot: PreservedManagedCodexAuthoritySnapshot
  ) => Promise<T>
): Promise<T> {
  const now = new Date(nowInput.getTime());
  const asOf = now.toISOString();
  await assertWorkResumptionPreserveBoundary(cwd);
  const [bindingRead, heartbeatRead] = await Promise.all([
    readWorkResumptionPrivateJsonPreservingState(
      join(workResumptionLocalDirectory(cwd), BINDINGS_FILENAME),
      workSessionBindingStoreSchema,
      cwd
    ),
    readWorkResumptionPrivateJsonPreservingState(
      join(workResumptionLocalDirectory(cwd), HEARTBEAT_FILENAME),
      workResumptionHeartbeatSchema,
      cwd
    )
  ]);
  const bindingStore =
    bindingRead.status === "available"
      ? bindingRead.value
      : createEmptyWorkSessionBindingStore(asOf);
  const heartbeat =
    heartbeatRead.status === "available" ? heartbeatRead.value : null;
  const connectionGeneration =
    codexConfig === null
      ? null
      : workResumptionCodexConnectionGeneration({
          installationSecret: codexConfig.installationSecret,
          discoveredAt: codexConfig.discoveredAt
        });
  const authority: ManagedCodexAuthoritySnapshot = {
    activeOwnerInstanceId:
      heartbeat && isFreshWorkResumptionHeartbeat(heartbeat, now)
        ? heartbeat.instanceId
        : null,
    activeOwnerships:
      connectionGeneration === null
        ? []
        : currentStoredWorkSessionBindings(bindingStore).map((binding) => ({
            bindingId: binding.bindingId,
            executionId: binding.executionId,
            scopeId: binding.scopeId,
            connectionGeneration
          }))
  };
  const result = await read({
    asOf,
    now,
    authority,
    bindingStore,
    codexConfig
  });
  await assertWorkResumptionPreserveBoundary(cwd);
  const [confirmedBindingRead, confirmedHeartbeatRead] = await Promise.all([
    readWorkResumptionPrivateJsonPreservingState(
      join(workResumptionLocalDirectory(cwd), BINDINGS_FILENAME),
      workSessionBindingStoreSchema,
      cwd
    ),
    readWorkResumptionPrivateJsonPreservingState(
      join(workResumptionLocalDirectory(cwd), HEARTBEAT_FILENAME),
      workResumptionHeartbeatSchema,
      cwd
    )
  ]);
  if (
    !samePrivateReadResult(bindingRead, confirmedBindingRead) ||
    !samePrivateReadResult(heartbeatRead, confirmedHeartbeatRead)
  ) {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  return result;
}

export function withWorkResumptionStateLease<T>(
  cwd: string,
  mutation: () => Promise<T>
): Promise<T> {
  return withWorkResumptionMutation(cwd, mutation);
}

function bindingMatchesCommand(
  binding: {
    bindingId: string;
    executionId: string;
    scopeId: string;
  },
  command: WorkResumptionCommand
): boolean {
  return (
    binding.bindingId === command.bindingId &&
    binding.executionId === command.executionId &&
    binding.scopeId === command.scopeId
  );
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

async function readWorkResumptionPrivateJsonPreservingState<T>(
  path: string,
  schema: ZodType<T>,
  cwd: string
): Promise<PreservedPrivateJsonRead<T>> {
  let chainStatus: Awaited<
    ReturnType<typeof inspectLocalPrivateDirectoryChain>
  >;
  try {
    chainStatus = await inspectLocalPrivateDirectoryChain(
      cwd,
      dirname(path)
    );
  } catch {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  if (chainStatus === "missing") {
    return { status: "missing", fingerprint: null };
  }

  let metadataBefore;
  try {
    metadataBefore = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { status: "missing", fingerprint: null };
    }
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  if (!metadataBefore.isFile() || metadataBefore.isSymbolicLink()) {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  const fingerprint = preservedFileFingerprint(metadataBefore);

  let text: string;
  try {
    text = await readLocalPrivateText(path, "preserve", cwd);
    const metadataAfter = await lstat(path);
    if (
      !metadataAfter.isFile() ||
      metadataAfter.isSymbolicLink() ||
      !samePreservedFileFingerprint(
        fingerprint,
        preservedFileFingerprint(metadataAfter)
      )
    ) {
      throw new WorkResumptionStoreError("STORE_INVALID");
    }
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new WorkResumptionStoreError("STORE_INVALID");
    }
    return {
      status: "available",
      value: parsed.data,
      fingerprint
    };
  } catch (error) {
    if (error instanceof WorkResumptionStoreError) throw error;
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
}

async function assertWorkResumptionPreserveBoundary(
  cwd: string
): Promise<void> {
  const directory = workResumptionLocalDirectory(cwd);
  try {
    if (
      (await inspectLocalPrivateDirectoryChain(cwd, directory)) ===
      "missing"
    ) {
      return;
    }
  } catch {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  let filenames: string[];
  try {
    filenames = await readdir(directory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new WorkResumptionStoreError("STORE_READ_FAILED");
  }
  if (
    filenames.some(
      (filename) =>
        /\.tmp$/u.test(filename) ||
        isWorkArtifactAttributionTempFilename(filename)
    )
  ) {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  const locksDirectory = join(directory, LOCKS_DIRECTORY);
  try {
    if (
      (await inspectLocalPrivateDirectoryChain(
        cwd,
        locksDirectory
      )) === "missing"
    ) {
      return;
    }
  } catch {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
  let lockFilenames: string[];
  try {
    lockFilenames = await readdir(locksDirectory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new WorkResumptionStoreError("STORE_READ_FAILED");
  }
  if (
    lockFilenames.includes(`${STATE_LOCK_NAME}.lock`) ||
    lockFilenames.includes(`${HEARTBEAT_LOCK_NAME}.lock`)
  ) {
    throw new WorkResumptionStoreError("STORE_INVALID");
  }
}

function samePrivateReadResult<T>(
  left: PreservedPrivateJsonRead<T>,
  right: PreservedPrivateJsonRead<T>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preservedFileFingerprint(metadata: {
  dev: number;
  ino: number;
  mode: number;
  uid: number;
  gid: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}): PreservedFileFingerprint {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode & 0o777,
    ownerUid: metadata.uid,
    ownerGid: metadata.gid,
    linkCount: metadata.nlink,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    changedAtMs: metadata.ctimeMs
  };
}

function samePreservedFileFingerprint(
  left: PreservedFileFingerprint,
  right: PreservedFileFingerprint
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
      const renewal = startFilesystemLockRenewal(lease);
      try {
        return await mutation();
      } finally {
        await finishFilesystemLease(lease, renewal);
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
  ownerPid: number;
  device: number;
  inode: number;
};

type FilesystemLockRenewal = {
  stop: () => Promise<void>;
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
    let created = false;
    try {
      handle = await open(path, "wx", 0o600);
      created = true;
      await handle.writeFile(`${token}\n${process.pid}\n`, "utf8");
      const metadata = await handle.stat();
      await handle.close();
      await chmod(path, 0o600);
      return {
        path,
        token,
        ownerPid: process.pid,
        device: metadata.dev,
        inode: metadata.ino
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!isNodeError(error, "EEXIST")) {
        if (created) {
          await removeFilesystemLockIfTokenMatches(path, token).catch(
            () => undefined
          );
        }
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
    const first = await readFilesystemLockSnapshot(path);
    if (!filesystemLockSnapshotIsStale(first)) return;
    // A live local process is authoritative even when its event loop could
    // not renew on time. Prefer a bounded acquisition failure to overlapping
    // mutations. Legacy token-only locks still use the stale-time fallback.
    if (filesystemLockOwnerMayBeAlive(first.ownerPid)) return;

    // A live owner may renew between the first observation and deletion.
    // Re-read the token, inode, and mtime immediately before unlinking so an
    // old observation cannot remove a replacement or freshly renewed lease.
    const confirmed = await readFilesystemLockSnapshot(path);
    if (
      !sameFilesystemLockSnapshot(first, confirmed) ||
      !filesystemLockSnapshotIsStale(confirmed) ||
      filesystemLockOwnerMayBeAlive(confirmed.ownerPid)
    ) {
      return;
    }
    await unlink(path);
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
    const current = await readFilesystemLockSnapshot(lease.path);
    if (!filesystemLockSnapshotBelongsToLease(current, lease)) {
      throw new WorkResumptionStoreError(
        "LOCK_ACQUISITION_FAILED"
      );
    }
    await unlink(lease.path);
  } catch (error) {
    if (error instanceof WorkResumptionStoreError) throw error;
    throw new WorkResumptionStoreError(
      "LOCK_ACQUISITION_FAILED"
    );
  }
}

function startFilesystemLockRenewal(
  lease: FilesystemLease
): FilesystemLockRenewal {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let failure: WorkResumptionStoreError | null = null;

  const schedule = () => {
    if (stopped || failure) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped || failure) return;
      inFlight = renewFilesystemLock(lease).catch(() => {
        failure = new WorkResumptionStoreError(
          "LOCK_ACQUISITION_FAILED"
        );
      });
      void inFlight.then(schedule);
    }, FILESYSTEM_LOCK_RENEW_MS);
    timer.unref?.();
  };

  schedule();
  return {
    stop: async () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
      if (failure) throw failure;
    }
  };
}

async function renewFilesystemLock(
  lease: FilesystemLease
): Promise<void> {
  const before = await readFilesystemLockSnapshot(lease.path);
  if (!filesystemLockSnapshotBelongsToLease(before, lease)) {
    throw new WorkResumptionStoreError(
      "LOCK_ACQUISITION_FAILED"
    );
  }
  const renewedAtMs = Math.max(Date.now(), before.modifiedAtMs + 1);
  const renewedAt = new Date(renewedAtMs);
  await utimes(lease.path, renewedAt, renewedAt);
  const after = await readFilesystemLockSnapshot(lease.path);
  if (!filesystemLockSnapshotBelongsToLease(after, lease)) {
    throw new WorkResumptionStoreError(
      "LOCK_ACQUISITION_FAILED"
    );
  }
}

async function finishFilesystemLease(
  lease: FilesystemLease,
  renewal: FilesystemLockRenewal
): Promise<void> {
  let renewalError: unknown = null;
  try {
    await renewal.stop();
  } catch (error) {
    renewalError = error;
  }

  let releaseError: unknown = null;
  try {
    await releaseFilesystemLock(lease);
  } catch (error) {
    releaseError = error;
  }
  if (renewalError) throw renewalError;
  if (releaseError) throw releaseError;
}

type FilesystemLockSnapshot = {
  token: string;
  ownerPid: number | null;
  device: number;
  inode: number;
  modifiedAtMs: number;
};

async function readFilesystemLockSnapshot(
  path: string
): Promise<FilesystemLockSnapshot> {
  const [content, metadata] = await Promise.all([
    readFile(path, "utf8"),
    lstat(path)
  ]);
  const [token = "", ownerPidText] = content.trim().split("\n");
  const ownerPid = Number(ownerPidText);
  return {
    token,
    ownerPid:
      Number.isSafeInteger(ownerPid) && ownerPid > 0
        ? ownerPid
        : null,
    device: metadata.dev,
    inode: metadata.ino,
    modifiedAtMs: metadata.mtimeMs
  };
}

function filesystemLockSnapshotBelongsToLease(
  snapshot: FilesystemLockSnapshot,
  lease: FilesystemLease
): boolean {
  return (
    snapshot.token === lease.token &&
    snapshot.ownerPid === lease.ownerPid &&
    snapshot.device === lease.device &&
    snapshot.inode === lease.inode
  );
}

function sameFilesystemLockSnapshot(
  left: FilesystemLockSnapshot,
  right: FilesystemLockSnapshot
): boolean {
  return (
    left.token === right.token &&
    left.ownerPid === right.ownerPid &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

function filesystemLockSnapshotIsStale(
  snapshot: FilesystemLockSnapshot
): boolean {
  return Date.now() - snapshot.modifiedAtMs > FILESYSTEM_LOCK_STALE_MS;
}

function filesystemLockOwnerMayBeAlive(
  ownerPid: number | null
): boolean {
  if (ownerPid === null) return false;
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

async function removeFilesystemLockIfTokenMatches(
  path: string,
  token: string
): Promise<void> {
  const current = await readFilesystemLockSnapshot(path);
  if (current.token === token) await unlink(path);
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
