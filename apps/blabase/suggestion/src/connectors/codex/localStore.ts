import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  cleanupStaleConnectorTempFiles,
  withActiveConnectorTempFile
} from "../localTempCleanup";
import {
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_RETENTION_DAYS,
  codexConversationStoreSchema,
  codexSessionContentManifestSchema,
  conversationStoreSha256,
  emptyCodexContentManifest,
  type CodexConversationStore
} from "./conversationContract";
import {
  CODEX_OBSERVATION_HISTORY_CONTRACT,
  codexObservationHistorySchema,
  observeCodexInventorySession,
  parseCodexObservationHistory,
  type CodexObservationHistory
} from "./observationContract";
import {
  parseCodexLocalGitSnapshot,
  type CodexLocalGitSnapshot
} from "./localGitContracts";
import type {
  CodexSnapshot,
  StoredCodexConfig
} from "./types";

const CODEX_STORE_BASENAMES = [
  "config.json",
  "snapshot.json",
  "local-git.json",
  "observation-history.json",
  "conversation-history.json"
] as const;

const scopeSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  queryPath: z.string().min(1),
  label: z.string().min(1).max(120),
  sessionCount: z.number().int().nonnegative(),
  lastActivityAt: z.string().datetime()
});

const configSchema = z
  .object({
    schemaVersion: z.literal("codex-connector-config-v3"),
    installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
    selectedScopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)),
    scopes: z.array(scopeSchema),
    contentMode: z.enum([
      "metadata_only",
      "activity_summary",
      "conversation_and_execution"
    ]),
    contentConsentAt: z.string().datetime().nullable(),
    conversationConsentContract: z
      .literal(CODEX_CONVERSATION_CONSENT_CONTRACT)
      .nullable(),
    conversationConsentAt: z.string().datetime().nullable(),
    conversationRetentionDays: z
      .literal(CODEX_CONVERSATION_RETENTION_DAYS)
      .nullable(),
    discoveredAt: z.string().datetime()
  })
  .superRefine((config, context) => {
    const summaryConsentExpected =
      config.contentMode !== "metadata_only";
    const conversationConsentExpected =
      config.contentMode === "conversation_and_execution";
    if (
      summaryConsentExpected !== (config.contentConsentAt !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentConsentAt"],
        message: "Codex content consent does not match content mode."
      });
    }
    if (
      conversationConsentExpected !==
        (config.conversationConsentContract !== null) ||
      conversationConsentExpected !==
        (config.conversationConsentAt !== null) ||
      conversationConsentExpected !==
        (config.conversationRetentionDays !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationConsentAt"],
        message:
          "Codex conversation consent does not match content mode."
      });
    }
  });

const legacyV2ConfigSchema = z.object({
  schemaVersion: z.literal("codex-connector-config-v2"),
  installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
  selectedScopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)),
  scopes: z.array(scopeSchema),
  contentMode: z.enum(["metadata_only", "activity_summary"]),
  contentConsentAt: z.string().datetime().nullable(),
  discoveredAt: z.string().datetime()
});

const legacyV1ConfigSchema = z.object({
  schemaVersion: z.literal("codex-connector-config-v1"),
  installationSecret: z.string().regex(/^[a-f0-9]{64}$/),
  selectedScopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)),
  scopes: z.array(scopeSchema),
  discoveredAt: z.string().datetime()
});

const sessionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  source: z.literal("codex"),
  kind: z.literal("coding_session"),
  scopeId: z.string().regex(/^[a-f0-9]{24}$/),
  projectLabel: z.string().min(1).max(120),
  taskSummary: z.string().min(1).max(200).nullable(),
  taskSummarySource: z
    .enum(["thread_name", "first_user_request"])
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activityState: z.enum([
    "active",
    "idle",
    "not_loaded",
    "system_error",
    "unknown"
  ]),
  attentionState: z
    .enum(["waiting_on_approval", "waiting_on_user_input"])
    .nullable(),
  content: codexSessionContentManifestSchema
});

const legacyV2SessionSchema = sessionSchema.omit({
  content: true
});

const legacyV1SessionSchema = legacyV2SessionSchema.omit({
  taskSummary: true,
  taskSummarySource: true
});

const snapshotSchema = z
  .object({
    schemaVersion: z.literal("codex-snapshot-v3"),
    collectorVersion: z.enum([
      "codex-app-server-metadata-v1",
      "codex-app-server-activity-summary-v1",
      "codex-app-server-conversation-and-execution-v1"
    ]),
    contentMode: z.enum([
      "metadata_only",
      "activity_summary",
      "conversation_and_execution"
    ]),
    codexVersion: z.string().min(1).max(120),
    fetchedAt: z.string().datetime(),
    lookbackStart: z.string().datetime(),
    truncated: z.boolean(),
    conversationStoreSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    conversationRetentionDays: z
      .literal(CODEX_CONVERSATION_RETENTION_DAYS)
      .nullable(),
    scopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1),
    sessions: z.array(sessionSchema)
  })
  .superRefine((snapshot, context) => {
    const conversationExpected =
      snapshot.contentMode === "conversation_and_execution";
    if (
      conversationExpected !==
        (snapshot.conversationStoreSha256 !== null) ||
      conversationExpected !==
        (snapshot.conversationRetentionDays !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationStoreSha256"],
        message:
          "Codex conversation manifest does not match content mode."
      });
    }
    snapshot.sessions.forEach((session, index) => {
      const summaryFieldsMatch =
        (session.taskSummary === null) ===
        (session.taskSummarySource === null);
      if (
        !summaryFieldsMatch ||
        (snapshot.contentMode === "metadata_only" &&
          session.taskSummary !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "taskSummary"],
          message: "Codex task summary does not match content mode."
        });
      }
      if (
        snapshot.contentMode !== "conversation_and_execution" &&
        session.content.contentSha256 !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "content"],
          message:
            "Raw conversation manifests require conversation mode."
        });
      }
    });
  });

const legacyV2SnapshotSchema = z.object({
  schemaVersion: z.literal("codex-snapshot-v2"),
  collectorVersion: z.enum([
    "codex-app-server-metadata-v1",
    "codex-app-server-activity-summary-v1"
  ]),
  contentMode: z.enum(["metadata_only", "activity_summary"]),
  codexVersion: z.string().min(1).max(120),
  fetchedAt: z.string().datetime(),
  lookbackStart: z.string().datetime(),
  truncated: z.boolean(),
  scopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1),
  sessions: z.array(legacyV2SessionSchema)
});

const legacyV1SnapshotSchema = z.object({
  schemaVersion: z.literal("codex-snapshot-v1"),
  collectorVersion: z.literal("codex-app-server-metadata-v1"),
  contentMode: z.literal("metadata_only"),
  codexVersion: z.string().min(1).max(120),
  fetchedAt: z.string().datetime(),
  lookbackStart: z.string().datetime(),
  truncated: z.boolean(),
  scopeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1),
  sessions: z.array(legacyV1SessionSchema)
});

const CODEX_STORE_COORDINATION_KEY = Symbol.for(
  "blabase.codex-store-coordination.v1"
);

type CodexStoreCoordination = {
  mutationTails: Map<string, Promise<void>>;
  storeGenerations: Map<string, number>;
};

function sharedCodexStoreCoordination(): CodexStoreCoordination {
  const existing = Reflect.get(
    globalThis,
    CODEX_STORE_COORDINATION_KEY
  );
  if (
    existing &&
    typeof existing === "object" &&
    "mutationTails" in existing &&
    existing.mutationTails instanceof Map &&
    "storeGenerations" in existing &&
    existing.storeGenerations instanceof Map
  ) {
    return existing as CodexStoreCoordination;
  }
  const created: CodexStoreCoordination = {
    mutationTails: new Map(),
    storeGenerations: new Map()
  };
  Reflect.set(globalThis, CODEX_STORE_COORDINATION_KEY, created);
  return created;
}

const codexStoreCoordination = sharedCodexStoreCoordination();

export function codexLocalDirectory(cwd = process.cwd()): string {
  return join(cwd, ".local", "connectors", "codex");
}

function codexStoreKey(cwd: string): string {
  return resolve(codexLocalDirectory(cwd));
}

export async function readStoredCodexConfig(
  cwd = process.cwd()
): Promise<StoredCodexConfig | null> {
  await cleanupStaleCodexTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "config.json"),
      "utf8"
    );
    const value = migrateMissingConversationConsentContract(
      JSON.parse(text)
    );
    const current = configSchema.safeParse(value);
    if (current.success) {
      await enforceConversationRetention(current.data, cwd);
      return current.data;
    }
    const legacyV2 = legacyV2ConfigSchema.safeParse(value);
    if (legacyV2.success) {
      const migrated = configSchema.parse({
        ...legacyV2.data,
        schemaVersion: "codex-connector-config-v3",
        conversationConsentContract: null,
        conversationConsentAt: null,
        conversationRetentionDays: null
      });
      await enforceConversationRetention(migrated, cwd);
      return migrated;
    }
    const legacy = legacyV1ConfigSchema.parse(value);
    const migrated = configSchema.parse({
      ...legacy,
      schemaVersion: "codex-connector-config-v3",
      contentMode: "metadata_only",
      contentConsentAt: null,
      conversationConsentContract: null,
      conversationConsentAt: null,
      conversationRetentionDays: null
    });
    await enforceConversationRetention(migrated, cwd);
    return migrated;
  } catch (error) {
    if (!isMissingFileError(error)) {
      await deleteIfPresent(
        join(
          codexLocalDirectory(cwd),
          "conversation-history.json"
        )
      ).catch(() => undefined);
    }
    return null;
  }
}

export async function writeStoredCodexConfig(
  config: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await writePrivateJson(
      "config.json",
      configSchema.parse(config),
      cwd
    );
  });
}

export async function transitionStoredCodexConfig(
  previousConfig: StoredCodexConfig,
  nextConfig: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    const currentConfig = await readStoredCodexConfig(cwd);
    if (!sameConnectionSelection(currentConfig, previousConfig)) {
      throw new Error("Codex connector selection changed during update.");
    }

    const scopeChanged = !sameScopeSelection(
      previousConfig,
      nextConfig
    );
    const contentModeChanged =
      previousConfig.contentMode !== nextConfig.contentMode;
    const privacyReducingChange =
      previousConfig.contentMode ===
        "conversation_and_execution" &&
      nextConfig.contentMode !==
        "conversation_and_execution";

    if (privacyReducingChange) {
      // Disable future collection before deleting raw content. A failed purge
      // must never leave the old consent active.
      await writePrivateJson(
        "config.json",
        configSchema.parse(nextConfig),
        cwd
      );
    }

    if (scopeChanged || contentModeChanged) {
      await Promise.all([
        deleteIfPresent(
          join(codexLocalDirectory(cwd), "snapshot.json")
        ),
        deleteIfPresent(
          join(codexLocalDirectory(cwd), "local-git.json")
        ),
        deleteIfPresent(
          join(
            codexLocalDirectory(cwd),
            "observation-history.json"
          )
        ),
        deleteIfPresent(
          join(codexLocalDirectory(cwd), "conversation-history.json")
        )
      ]);
    }
    if (!privacyReducingChange) {
      await writePrivateJson(
        "config.json",
        configSchema.parse(nextConfig),
        cwd
      );
    }
  });
}

export async function readStoredCodexSnapshot(
  cwd = process.cwd()
): Promise<CodexSnapshot | null> {
  await cleanupStaleCodexTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    const value: unknown = JSON.parse(text);
    const current = snapshotSchema.safeParse(value);
    if (current.success) {
      if (
        current.data.contentMode ===
        "conversation_and_execution"
      ) {
        const conversationStore =
          await readStoredCodexConversationStore(cwd);
        if (
          !conversationStore ||
          conversationStoreSha256(conversationStore) !==
            current.data.conversationStoreSha256 ||
          !sameStringSet(
            conversationStore.scopeIds,
            current.data.scopeIds
          )
        ) {
          return null;
        }
      }
      return current.data;
    }
    const legacyV2 = legacyV2SnapshotSchema.safeParse(value);
    if (legacyV2.success) {
      return snapshotSchema.parse({
        ...legacyV2.data,
        schemaVersion: "codex-snapshot-v3",
        conversationStoreSha256: null,
        conversationRetentionDays: null,
        sessions: legacyV2.data.sessions.map((session) => ({
          ...session,
          content: emptyCodexContentManifest()
        }))
      });
    }
    const legacy = legacyV1SnapshotSchema.parse(value);
    return {
      ...legacy,
      schemaVersion: "codex-snapshot-v3",
      conversationStoreSha256: null,
      conversationRetentionDays: null,
      sessions: legacy.sessions.map((session) => ({
        ...session,
        taskSummary: null,
        taskSummarySource: null,
        content: emptyCodexContentManifest()
      }))
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      await deleteIfPresent(
        join(
          codexLocalDirectory(cwd),
          "conversation-history.json"
        )
      ).catch(() => undefined);
    }
    return null;
  }
}

export async function writeStoredCodexSnapshot(
  snapshot: CodexSnapshot,
  expectedConfig: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd),
  conversationStore?: CodexConversationStore
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    const currentConfig = await readStoredCodexConfig(cwd);
    if (
      !currentConfig ||
      !sameConnectionSelection(currentConfig, expectedConfig)
    ) {
      throw new Error("Codex connector selection changed during sync.");
    }
    const observationHistory = await nextObservationHistory(
      snapshot,
      cwd
    );
    if (snapshot.contentMode === "conversation_and_execution") {
      if (!conversationStore) {
        throw new Error(
          "Codex conversation mode requires a conversation store."
        );
      }
      const parsedConversationStore =
        codexConversationStoreSchema.parse(conversationStore);
      if (
        conversationStoreSha256(parsedConversationStore) !==
          snapshot.conversationStoreSha256 ||
        !sameStringSet(
          parsedConversationStore.scopeIds,
          snapshot.scopeIds
        )
      ) {
        throw new Error(
          "Codex conversation store does not match its snapshot."
        );
      }
      await writePrivateJson(
        "conversation-history.json",
        parsedConversationStore,
        cwd
      );
    } else {
      await deleteIfPresent(
        join(codexLocalDirectory(cwd), "conversation-history.json")
      );
    }
    await writePrivateJson(
      "observation-history.json",
      observationHistory,
      cwd
    );
    await writePrivateJson(
      "snapshot.json",
      snapshotSchema.parse(snapshot),
      cwd
    );
  });
}

export async function readStoredCodexLocalGitSnapshot(
  cwd = process.cwd()
): Promise<CodexLocalGitSnapshot | null> {
  await cleanupStaleCodexTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "local-git.json"),
      "utf8"
    );
    return parseCodexLocalGitSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeStoredCodexLocalGitSnapshot(
  snapshot: CodexLocalGitSnapshot,
  expectedConfig: StoredCodexConfig,
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    const currentConfig = await readStoredCodexConfig(cwd);
    if (
      !currentConfig ||
      !sameConnectionSelection(currentConfig, expectedConfig)
    ) {
      throw new Error("Codex connector selection changed during sync.");
    }
    const parsed = parseCodexLocalGitSnapshot(snapshot);
    const selectedScopeIds = new Set(currentConfig.selectedScopeIds);
    if (
      parsed.scopeIds.some(
        (scopeId) => !selectedScopeIds.has(scopeId)
      )
    ) {
      throw new Error("Local Git snapshot includes an unselected scope.");
    }
    await writePrivateJson("local-git.json", parsed, cwd);
  });
}

export async function deleteStoredCodexLocalGitSnapshot(
  cwd = process.cwd(),
  expectedGeneration = codexStoreGeneration(cwd)
): Promise<void> {
  await withCodexStoreMutation(cwd, async () => {
    assertCurrentGeneration(cwd, expectedGeneration);
    await deleteIfPresent(
      join(codexLocalDirectory(cwd), "local-git.json")
    );
  });
}

export async function deleteStoredCodexConnection(
  cwd = process.cwd()
): Promise<void> {
  codexStoreCoordination.storeGenerations.set(
    codexStoreKey(cwd),
    codexStoreGeneration(cwd) + 1
  );
  await withCodexStoreMutation(cwd, async () => {
    const config = await readStoredCodexConfig(cwd);
    if (config?.contentMode === "conversation_and_execution") {
      // Persist revocation before touching the raw artifact. If deletion
      // fails, the remaining config is a durable tombstone that blocks any
      // in-flight or later raw collection and makes a retry possible.
      await writePrivateJson(
        "config.json",
        configSchema.parse({
          ...config,
          contentMode: "metadata_only",
          contentConsentAt: null,
          conversationConsentContract: null,
          conversationConsentAt: null,
          conversationRetentionDays: null
        }),
        cwd
      );
    }
    await deleteIfPresent(
      join(codexLocalDirectory(cwd), "conversation-history.json")
    );
    await Promise.all([
      deleteIfPresent(join(codexLocalDirectory(cwd), "snapshot.json")),
      deleteIfPresent(join(codexLocalDirectory(cwd), "local-git.json")),
      deleteIfPresent(
        join(codexLocalDirectory(cwd), "observation-history.json")
      )
    ]);
    await deleteIfPresent(
      join(codexLocalDirectory(cwd), "config.json")
    );
    await cleanupStaleCodexTempFiles(cwd, false);
  });
}

export async function readStoredCodexObservationHistory(
  cwd = process.cwd()
): Promise<CodexObservationHistory | null> {
  await cleanupStaleCodexTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "observation-history.json"),
      "utf8"
    );
    return parseCodexObservationHistory(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function readStoredCodexConversationStore(
  cwd = process.cwd()
): Promise<CodexConversationStore | null> {
  await cleanupStaleCodexTempFiles(cwd, true);
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "conversation-history.json"),
      "utf8"
    );
    const store = codexConversationStoreSchema.parse(
      JSON.parse(text)
    );
    if (Date.parse(store.expiresAt) <= Date.now()) {
      await deleteIfPresent(
        join(
          codexLocalDirectory(cwd),
          "conversation-history.json"
        )
      );
      return null;
    }
    return store;
  } catch (error) {
    if (!isMissingFileError(error)) {
      await deleteIfPresent(
        join(
          codexLocalDirectory(cwd),
          "conversation-history.json"
        )
      ).catch(() => undefined);
    }
    return null;
  }
}

export function createCodexInstallationSecret(): string {
  return randomBytes(32).toString("hex");
}

export function codexStoreGeneration(cwd = process.cwd()): number {
  return (
    codexStoreCoordination.storeGenerations.get(codexStoreKey(cwd)) ??
    0
  );
}

async function nextObservationHistory(
  snapshot: CodexSnapshot,
  cwd: string
): Promise<CodexObservationHistory> {
  const existing = await readObservationHistoryForAppend(cwd);
  const retentionStart = Date.parse(snapshot.fetchedAt) -
    30 * 24 * 60 * 60 * 1_000;
  const retained = existing.observations.filter(
    (observation) =>
      Date.parse(observation.observedAt) >= retentionStart
  );
  const latestByExecution = new Map(
    retained.map((observation) => [
      observation.executionId,
      observation
    ])
  );
  let sequence =
    existing.observations.reduce(
      (maximum, observation) =>
        Math.max(maximum, observation.sequence),
      -1
    ) + 1;
  const appended = snapshot.sessions.flatMap((session) => {
    const observation = observeCodexInventorySession({
      session,
      observedAt: snapshot.fetchedAt,
      sequence
    });
    const previous = latestByExecution.get(
      observation.executionId
    );
    if (
      previous &&
      sameCodexObservationState(previous, observation)
    ) {
      return [];
    }
    sequence += 1;
    latestByExecution.set(observation.executionId, observation);
    return [observation];
  });
  const observations = [...retained, ...appended];
  return codexObservationHistorySchema.parse({
    contract: CODEX_OBSERVATION_HISTORY_CONTRACT,
    updatedAt: snapshot.fetchedAt,
    observations
  });
}

function sameCodexObservationState(
  left: CodexObservationHistory["observations"][number],
  right: CodexObservationHistory["observations"][number]
): boolean {
  return (
    left.executionId === right.executionId &&
    left.observationMode === right.observationMode &&
    left.liveObservationAvailable ===
      right.liveObservationAvailable &&
    left.executionState === right.executionState &&
    left.inventoryActivityState ===
      right.inventoryActivityState &&
    left.waitingState === right.waitingState &&
    left.sourceEvent === right.sourceEvent &&
    left.sourceUpdatedAt === right.sourceUpdatedAt &&
    left.reasonCode === right.reasonCode
  );
}

async function readObservationHistoryForAppend(
  cwd: string
): Promise<CodexObservationHistory> {
  try {
    const text = await readFile(
      join(codexLocalDirectory(cwd), "observation-history.json"),
      "utf8"
    );
    return parseCodexObservationHistory(JSON.parse(text));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return codexObservationHistorySchema.parse({
        contract: CODEX_OBSERVATION_HISTORY_CONTRACT,
        updatedAt: new Date(0).toISOString(),
        observations: []
      });
    }
    throw new Error("Codex observation history is invalid.");
  }
}

async function writePrivateJson(
  filename: string,
  value: unknown,
  cwd: string
): Promise<void> {
  const directory = codexLocalDirectory(cwd);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const target = join(directory, filename);
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString(
    "hex"
  )}.tmp`;
  await withActiveConnectorTempFile(temporary, async () => {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  });
}

async function deleteIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function enforceConversationRetention(
  config: StoredCodexConfig,
  cwd: string
): Promise<void> {
  const path = join(
    codexLocalDirectory(cwd),
    "conversation-history.json"
  );
  if (config.contentMode !== "conversation_and_execution") {
    await deleteIfPresent(path).catch(() => undefined);
    return;
  }
  try {
    const text = await readFile(path, "utf8");
    const store = codexConversationStoreSchema.parse(
      JSON.parse(text)
    );
    if (Date.parse(store.expiresAt) <= Date.now()) {
      await deleteIfPresent(path);
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      // Invalid private content is never trusted or retained.
      await deleteIfPresent(path).catch(() => undefined);
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );
}

async function cleanupStaleCodexTempFiles(
  cwd: string,
  bestEffort: boolean
): Promise<void> {
  const cleanup = cleanupStaleConnectorTempFiles({
    directory: codexLocalDirectory(cwd),
    canonicalBasenames: CODEX_STORE_BASENAMES,
    removeFresh: !bestEffort
  });
  if (bestEffort) {
    await cleanup.catch(() => undefined);
    return;
  }
  await cleanup;
}

function sameConnectionSelection(
  current: StoredCodexConfig | null,
  expected: StoredCodexConfig
): boolean {
  if (
    !current ||
    current.installationSecret !== expected.installationSecret ||
    current.contentMode !== expected.contentMode ||
    current.contentConsentAt !== expected.contentConsentAt ||
    current.conversationConsentContract !==
      expected.conversationConsentContract ||
    current.conversationConsentAt !==
      expected.conversationConsentAt ||
    current.conversationRetentionDays !==
      expected.conversationRetentionDays
  ) {
    return false;
  }
  return sameScopeSelection(current, expected);
}

function migrateMissingConversationConsentContract(
  input: unknown
): unknown {
  if (
    !input ||
    typeof input !== "object" ||
    (input as Record<string, unknown>).schemaVersion !==
      "codex-connector-config-v3" ||
    "conversationConsentContract" in input
  ) {
    return input;
  }
  const config = input as Record<string, unknown>;
  if (config.contentMode === "conversation_and_execution") {
    // A v3 file without the exact consent contract cannot prove current raw
    // consent. Downgrade conservatively so the read path purges raw content.
    return {
      ...config,
      contentMode: "activity_summary",
      conversationConsentContract: null,
      conversationConsentAt: null,
      conversationRetentionDays: null
    };
  }
  return {
    ...config,
    conversationConsentContract: null
  };
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[]
): boolean {
  const leftSorted = [...new Set(left)].sort();
  const rightSorted = [...new Set(right)].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every(
      (value, index) => value === rightSorted[index]
    )
  );
}

function sameScopeSelection(
  current: StoredCodexConfig,
  expected: StoredCodexConfig
): boolean {
  if (current.installationSecret !== expected.installationSecret) {
    return false;
  }
  const currentIds = [...new Set(current.selectedScopeIds)].sort();
  const expectedIds = [...new Set(expected.selectedScopeIds)].sort();
  return (
    currentIds.length === expectedIds.length &&
    currentIds.every(
      (scopeId, index) => scopeId === expectedIds[index]
    )
  );
}

function assertCurrentGeneration(
  cwd: string,
  expectedGeneration: number
): void {
  if (codexStoreGeneration(cwd) !== expectedGeneration) {
    throw new Error("Codex connector state changed during operation.");
  }
}

async function withCodexStoreMutation<T>(
  cwd: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = codexStoreKey(cwd);
  const previous =
    codexStoreCoordination.mutationTails.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  codexStoreCoordination.mutationTails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (codexStoreCoordination.mutationTails.get(key) === tail) {
      codexStoreCoordination.mutationTails.delete(key);
    }
  }
}
