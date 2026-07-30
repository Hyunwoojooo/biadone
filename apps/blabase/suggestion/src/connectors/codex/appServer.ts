import { createHmac } from "node:crypto";
import {
  spawn,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { isAbsolute } from "node:path";

import { z } from "zod";

import {
  CODEX_APP_SERVER_TIMEOUT_MS,
  CODEX_LOOKBACK_DAYS,
  CODEX_THREAD_LIMIT,
  resolveCodexBinary
} from "./config";
import {
  CODEX_CONVERSATION_COLLECTOR_VERSION,
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_RETENTION_DAYS,
  CODEX_CONVERSATION_THREAD_READ_LIMIT,
  codexConversationStoreSchema,
  conversationStoreSha256,
  emptyCodexContentManifest,
  failedCodexContentManifest,
  manifestFromConversationSession,
  normalizeCodexThreadRead,
  type CodexConversationSession,
  type CodexConversationStore
} from "./conversationContract";
import {
  codexStoreGeneration,
  createCodexInstallationSecret,
  readStoredCodexConversationStore,
  readStoredCodexConfig,
  transitionStoredCodexConfig,
  writeStoredCodexConfig,
  writeStoredCodexSnapshot
} from "./localStore";
import type {
  CodexActivityState,
  CodexAttentionState,
  CodexContentMode,
  CodexSessionContentManifest,
  CodexSessionSignal,
  CodexSnapshot,
  StoredCodexConfig,
  StoredCodexScope
} from "./types";

const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const RPC_CLIENT_NAME = "blabase_suggestion";
const RPC_CLIENT_TITLE = "blabase Suggestion";
const RPC_CLIENT_VERSION = "0.1.0";
const INTERACTIVE_SOURCE_KINDS = [
  "cli",
  "vscode",
  "appServer",
  "exec"
] as const;

const threadListSchema = z
  .object({
    data: z.array(z.unknown()),
    nextCursor: z.string().nullable().optional()
  })
  .strip();

const rawThreadSchema = z
  .object({
    id: z.string().min(1),
    cwd: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    preview: z.string().nullable().optional(),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite().nullable().optional(),
    status: z.unknown().optional()
  })
  .strip();

const rawStatusSchema = z
  .object({
    type: z.string(),
    activeFlags: z.array(z.string()).optional()
  })
  .strip();

const initializeResultSchema = z
  .object({
    userAgent: z.string().min(1)
  })
  .strip();

export type CodexThreadListParams = {
  cursor?: string | null;
  limit: number;
  sortKey: "updated_at";
  sortDirection: "desc";
  sourceKinds: Array<(typeof INTERACTIVE_SOURCE_KINDS)[number]>;
  useStateDbOnly: true;
  cwd?: string[];
};

export type CodexThreadQuery = (
  params: CodexThreadListParams,
  options?: CodexThreadHistoryQueryOptions
) => Promise<{
  codexVersion: string;
  result: unknown;
  threadReads?: CodexThreadReadResult[];
  historyReadLimitReached?: boolean;
}>;

export type CodexThreadHistoryQueryOptions = {
  includeTurns: true;
  maxThreadReads: number;
  shouldReadThread?: (thread: unknown) => boolean;
};

export type CodexThreadReadResult =
  | {
      threadId: string;
      status: "available";
      result: unknown;
    }
  | {
      threadId: string;
      status: "failed";
      errorCode: "THREAD_READ_FAILED";
    };

export type CodexConnectorErrorCode =
  | "CODEX_NOT_INSTALLED"
  | "INVALID_BINARY_OVERRIDE"
  | "APP_SERVER_START_FAILED"
  | "APP_SERVER_TIMEOUT"
  | "APP_SERVER_PROTOCOL_ERROR";

export class CodexConnectorError extends Error {
  constructor(
    public readonly code: CodexConnectorErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CodexConnectorError";
  }
}

type ConnectorOptions = {
  cwd?: string;
  now?: Date;
  queryThreads?: CodexThreadQuery;
};

const discoveryFlights = new Map<
  string,
  Promise<StoredCodexConfig>
>();
const syncFlights = new Map<string, Promise<CodexSnapshot>>();

export function discoverAndStoreCodexScopes(
  options: ConnectorOptions = {}
): Promise<StoredCodexConfig> {
  const cwd = options.cwd ?? process.cwd();
  const existing = discoveryFlights.get(cwd);
  if (existing) return existing;
  const storeGeneration = codexStoreGeneration(cwd);

  const flight = prepareCodexScopeDiscoveryOnce(
    {
      ...options,
      cwd
    },
    storeGeneration
  )
    .then(async (prepared) => {
      await persistPreparedCodexScopeDiscovery(prepared);
      return prepared.config;
    })
    .finally(() => {
      discoveryFlights.delete(cwd);
    });
  discoveryFlights.set(cwd, flight);
  return flight;
}

export type PreparedCodexScopeDiscovery = {
  cwd: string;
  storeGeneration: number;
  previousConfig: StoredCodexConfig | null;
  config: StoredCodexConfig;
};

export function prepareCodexScopeDiscovery(
  options: ConnectorOptions = {}
): Promise<PreparedCodexScopeDiscovery> {
  const cwd = options.cwd ?? process.cwd();
  return prepareCodexScopeDiscoveryOnce(
    { ...options, cwd },
    codexStoreGeneration(cwd)
  );
}

export async function persistPreparedCodexScopeDiscovery(
  prepared: PreparedCodexScopeDiscovery
): Promise<void> {
  if (prepared.previousConfig) {
    await transitionStoredCodexConfig(
      prepared.previousConfig,
      prepared.config,
      prepared.cwd,
      prepared.storeGeneration
    );
    return;
  }
  await writeStoredCodexConfig(
    prepared.config,
    prepared.cwd,
    prepared.storeGeneration
  );
}

export async function selectStoredCodexScopes(
  scopeIds: string[],
  cwd = process.cwd(),
  contentMode?: CodexContentMode,
  now = new Date(),
  conversationConsent?: {
    accepted: true;
    contract: typeof CODEX_CONVERSATION_CONSENT_CONTRACT;
    retentionDays: typeof CODEX_CONVERSATION_RETENTION_DAYS;
  }
): Promise<StoredCodexConfig> {
  const storeGeneration = codexStoreGeneration(cwd);
  const config = await readStoredCodexConfig(cwd);
  if (!config) {
    throw new CodexConnectorError(
      "APP_SERVER_PROTOCOL_ERROR",
      "Codex 프로젝트 범위를 먼저 확인해야 합니다."
    );
  }

  const allowedIds = new Set(config.scopes.map((scope) => scope.id));
  const uniqueIds = [...new Set(scopeIds)];
  if (
    uniqueIds.length === 0 ||
    uniqueIds.some((scopeId) => !allowedIds.has(scopeId))
  ) {
    throw new CodexConnectorError(
      "APP_SERVER_PROTOCOL_ERROR",
      "선택한 Codex 프로젝트 범위를 확인할 수 없습니다."
    );
  }

  const nextContentMode = contentMode ?? config.contentMode;
  const reusingConversationConsent =
    config.contentMode === "conversation_and_execution" &&
    config.conversationConsentContract ===
      CODEX_CONVERSATION_CONSENT_CONTRACT &&
    config.conversationConsentAt !== null &&
    config.conversationRetentionDays ===
      CODEX_CONVERSATION_RETENTION_DAYS;
  if (
    nextContentMode === "conversation_and_execution" &&
    !reusingConversationConsent &&
    (!conversationConsent?.accepted ||
      conversationConsent.contract !==
        CODEX_CONVERSATION_CONSENT_CONTRACT ||
      conversationConsent.retentionDays !==
        CODEX_CONVERSATION_RETENTION_DAYS)
  ) {
    throw new CodexConnectorError(
      "APP_SERVER_PROTOCOL_ERROR",
      "Codex 대화와 실행 기록 수집에 명시적인 동의가 필요합니다."
    );
  }

  const updated: StoredCodexConfig = {
    ...config,
    schemaVersion: "codex-connector-config-v3",
    selectedScopeIds: uniqueIds,
    contentMode: nextContentMode,
    contentConsentAt:
      nextContentMode !== "metadata_only"
        ? config.contentMode !== "metadata_only" &&
          config.contentConsentAt
          ? config.contentConsentAt
          : now.toISOString()
        : null,
    conversationConsentAt:
      nextContentMode === "conversation_and_execution"
        ? reusingConversationConsent
          ? config.conversationConsentAt
          : now.toISOString()
        : null,
    conversationConsentContract:
      nextContentMode === "conversation_and_execution"
        ? CODEX_CONVERSATION_CONSENT_CONTRACT
        : null,
    conversationRetentionDays:
      nextContentMode === "conversation_and_execution"
        ? CODEX_CONVERSATION_RETENTION_DAYS
        : null
  };
  await transitionStoredCodexConfig(
    config,
    updated,
    cwd,
    storeGeneration
  );
  return updated;
}

export function fetchAndStoreCodexSnapshot(
  config: StoredCodexConfig,
  options: ConnectorOptions = {}
): Promise<CodexSnapshot> {
  const cwd = options.cwd ?? process.cwd();
  const storeGeneration = codexStoreGeneration(cwd);
  const flightKey = [
    cwd,
    config.contentMode,
    ...[...new Set(config.selectedScopeIds)].sort()
  ].join("\u0000");
  const existing = syncFlights.get(flightKey);
  if (existing) return existing;

  const flight = fetchAndStoreCodexSnapshotOnce(
    config,
    {
      ...options,
      cwd
    },
    storeGeneration
  ).finally(() => {
    syncFlights.delete(flightKey);
  });
  syncFlights.set(flightKey, flight);
  return flight;
}

export async function queryCodexThreadsViaAppServer(
  params: CodexThreadListParams,
  options?: CodexThreadHistoryQueryOptions
): Promise<{
  codexVersion: string;
  result: unknown;
  threadReads?: CodexThreadReadResult[];
  historyReadLimitReached?: boolean;
}> {
  const resolution = await resolveCodexBinary();
  if (!resolution.ok) {
    throw new CodexConnectorError(
      resolution.reason === "invalid_override"
        ? "INVALID_BINARY_OVERRIDE"
        : "CODEX_NOT_INSTALLED",
      "Codex 실행 파일을 찾지 못했습니다."
    );
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      resolution.binaryPath,
      ["app-server", "--listen", "stdio://"],
      {
        cwd: process.cwd(),
        env: codexChildEnvironment(),
        shell: false,
        stdio: "pipe"
      }
    );
    await waitForSpawn(child);
  } catch (error) {
    if (error instanceof CodexConnectorError) throw error;
    throw new CodexConnectorError(
      "APP_SERVER_START_FAILED",
      "Codex App Server를 시작하지 못했습니다."
    );
  }

  const client = new CodexJsonRpcClient(child);
  try {
    const initializeResult = initializeResultSchema.parse(
      await client.request("initialize", {
        clientInfo: {
          name: RPC_CLIENT_NAME,
          title: RPC_CLIENT_TITLE,
          version: RPC_CLIENT_VERSION
        }
      })
    );
    client.notify("initialized", {});
    const result = await client.request("thread/list", params);
    const history = options
      ? await readSelectedThreadHistories(client, result, options)
      : null;
    return {
      codexVersion: normalizeCodexVersion(initializeResult.userAgent),
      result,
      ...(history
        ? {
            threadReads: history.threadReads,
            historyReadLimitReached:
              history.historyReadLimitReached
          }
        : {})
    };
  } catch (error) {
    if (error instanceof CodexConnectorError) throw error;
    throw new CodexConnectorError(
      "APP_SERVER_PROTOCOL_ERROR",
      "Codex App Server 응답을 해석하지 못했습니다."
    );
  } finally {
    client.close();
  }
}

async function readSelectedThreadHistories(
  client: CodexJsonRpcClient,
  threadListResult: unknown,
  options: CodexThreadHistoryQueryOptions
): Promise<{
  threadReads: CodexThreadReadResult[];
  historyReadLimitReached: boolean;
}> {
  const list = threadListSchema.parse(threadListResult);
  const eligibleIds = list.data.flatMap((threadInput) => {
    const parsed = rawThreadSchema.safeParse(threadInput);
    if (
      !parsed.success ||
      (options.shouldReadThread &&
        !options.shouldReadThread(threadInput))
    ) {
      return [];
    }
    return [parsed.data.id];
  });
  const selectedIds = eligibleIds.slice(0, options.maxThreadReads);
  const threadReads: CodexThreadReadResult[] = [];
  for (const threadId of selectedIds) {
    try {
      const result = await client.request("thread/read", {
        threadId,
        includeTurns: true
      });
      threadReads.push({
        threadId,
        status: "available",
        result
      });
    } catch {
      threadReads.push({
        threadId,
        status: "failed",
        errorCode: "THREAD_READ_FAILED"
      });
    }
  }
  return {
    threadReads,
    historyReadLimitReached:
      eligibleIds.length > selectedIds.length
  };
}

async function prepareCodexScopeDiscoveryOnce(
  options: Required<Pick<ConnectorOptions, "cwd">> & ConnectorOptions,
  storeGeneration: number
): Promise<PreparedCodexScopeDiscovery> {
  const now = options.now ?? new Date();
  const queryThreads =
    options.queryThreads ?? queryCodexThreadsViaAppServer;
  const existingConfig = await readStoredCodexConfig(options.cwd);
  const installationSecret =
    existingConfig?.installationSecret ?? createCodexInstallationSecret();
  const response = await queryThreads(baseThreadListParams());
  const parsed = threadListSchema.parse(response.result);
  const lookbackStart = lookbackStartFor(now);
  const grouped = new Map<
    string,
    { sessionCount: number; lastActivityAt: string }
  >();

  for (const raw of parsed.data) {
    const thread = rawThreadSchema.safeParse(raw);
    if (!thread.success) continue;
    const queryPath = normalizedLocalCwd(thread.data.cwd);
    const updatedAt = threadUpdatedAt(thread.data);
    if (!queryPath || !updatedAt || updatedAt < lookbackStart) continue;

    const existing = grouped.get(queryPath);
    grouped.set(queryPath, {
      sessionCount: (existing?.sessionCount ?? 0) + 1,
      lastActivityAt:
        !existing || updatedAt > existing.lastActivityAt
          ? updatedAt
          : existing.lastActivityAt
    });
  }

  const scopes = disambiguateScopeLabels(
    [...grouped.entries()].map(([queryPath, activity]) => ({
      id: stableId(installationSecret, `scope:${queryPath}`),
      queryPath,
      label: projectLabel(queryPath),
      ...activity
    }))
  ).sort(
    (left, right) =>
      Date.parse(right.lastActivityAt) -
        Date.parse(left.lastActivityAt) ||
      left.id.localeCompare(right.id)
  );
  const scopeIds = new Set(scopes.map((scope) => scope.id));
  const selectedScopeIds =
    existingConfig?.selectedScopeIds.filter((scopeId) =>
      scopeIds.has(scopeId)
    ) ?? [];
  const config: StoredCodexConfig = {
    schemaVersion: "codex-connector-config-v3",
    installationSecret,
    selectedScopeIds,
    scopes,
    contentMode: existingConfig?.contentMode ?? "metadata_only",
    contentConsentAt: existingConfig?.contentConsentAt ?? null,
    conversationConsentContract:
      existingConfig?.conversationConsentContract ?? null,
    conversationConsentAt:
      existingConfig?.conversationConsentAt ?? null,
    conversationRetentionDays:
      existingConfig?.conversationRetentionDays ?? null,
    discoveredAt: now.toISOString()
  };
  return {
    cwd: options.cwd,
    storeGeneration,
    previousConfig: existingConfig,
    config
  };
}

async function fetchAndStoreCodexSnapshotOnce(
  config: StoredCodexConfig,
  options: Required<Pick<ConnectorOptions, "cwd">> & ConnectorOptions,
  storeGeneration: number
): Promise<CodexSnapshot> {
  const now = options.now ?? new Date();
  const queryThreads =
    options.queryThreads ?? queryCodexThreadsViaAppServer;
  const selectedIds = new Set(config.selectedScopeIds);
  const selectedScopes = config.scopes.filter((scope) =>
    selectedIds.has(scope.id)
  );
  if (selectedScopes.length === 0) {
    throw new CodexConnectorError(
      "APP_SERVER_PROTOCOL_ERROR",
      "수집할 Codex 프로젝트가 선택되지 않았습니다."
    );
  }

  const conversationEnabled =
    config.contentMode === "conversation_and_execution" &&
    config.conversationConsentContract ===
      CODEX_CONVERSATION_CONSENT_CONTRACT &&
    config.conversationConsentAt !== null &&
    config.conversationRetentionDays ===
      CODEX_CONVERSATION_RETENTION_DAYS;
  const previousConversationStore = conversationEnabled
    ? await readStoredCodexConversationStore(options.cwd)
    : null;
  const reusableConversationStore =
    previousConversationStore &&
    Date.parse(previousConversationStore.expiresAt) >
      now.getTime() &&
    sameStringSet(
      previousConversationStore.scopeIds,
      selectedScopes.map((scope) => scope.id)
    )
      ? previousConversationStore
      : null;
  const previousConversationBySession = new Map(
    (reusableConversationStore?.sessions ?? []).map((session) => [
      session.sessionId,
      session
    ])
  );
  const rawRetentionStart = new Date(
    now.getTime() -
      CODEX_CONVERSATION_RETENTION_DAYS *
        24 *
        60 *
        60 *
        1_000
  ).toISOString();
  const response = conversationEnabled
    ? await queryThreads(
        {
          ...baseThreadListParams(),
          cwd: selectedScopes.map((scope) => scope.queryPath)
        },
        {
          includeTurns: true,
          maxThreadReads: CODEX_CONVERSATION_THREAD_READ_LIMIT,
          shouldReadThread(threadInput) {
            const parsed = rawThreadSchema.safeParse(threadInput);
            if (!parsed.success) return false;
            const updatedAt = threadUpdatedAt(parsed.data);
            if (!updatedAt || updatedAt < rawRetentionStart) {
              return false;
            }
            const sessionId = stableId(
              config.installationSecret,
              `thread:${parsed.data.id}`
            );
            const previous =
              previousConversationBySession.get(sessionId);
            return (
              !previous ||
              previous.contentSourceUpdatedAt !== updatedAt ||
              Date.parse(previous.expiresAt) <= now.getTime()
            );
          }
        }
      )
    : await queryThreads({
        ...baseThreadListParams(),
        cwd: selectedScopes.map((scope) => scope.queryPath)
      });
  const parsed = threadListSchema.parse(response.result);
  const lookbackStart = lookbackStartFor(now);
  const scopeByPath = new Map(
    selectedScopes.map((scope) => [scope.queryPath, scope])
  );
  const sessions = new Map<string, CodexSessionSignal>();
  const conversationSessions = new Map<
    string,
    CodexConversationSession
  >();
  const threadReadByNativeId = new Map(
    (response.threadReads ?? []).map((threadRead) => [
      threadRead.threadId,
      threadRead
    ])
  );
  const conversationExpiresAt = new Date(
    now.getTime() +
      CODEX_CONVERSATION_RETENTION_DAYS *
        24 *
        60 *
        60 *
        1_000
  ).toISOString();

  for (const raw of parsed.data) {
    const thread = rawThreadSchema.safeParse(raw);
    if (!thread.success) continue;
    const queryPath = normalizedLocalCwd(thread.data.cwd);
    const scope = queryPath ? scopeByPath.get(queryPath) : undefined;
    const createdAt = epochSecondsToIso(thread.data.createdAt);
    const updatedAt = threadUpdatedAt(thread.data);
    if (!scope || !createdAt || !updatedAt || updatedAt < lookbackStart) {
      continue;
    }

    const state = parseActivityState(thread.data.status);
    const taskSummary = codexTaskSummary(
      thread.data,
      config.contentMode
    );
    const id = stableId(
      config.installationSecret,
      `thread:${thread.data.id}`
    );
    const previousConversation =
      previousConversationBySession.get(id);
    let content = emptyCodexContentManifest();
    if (conversationEnabled) {
      if (updatedAt < rawRetentionStart) {
        content = emptyCodexContentManifest(
          "OUTSIDE_RAW_RETENTION_WINDOW"
        );
      } else {
        const threadRead = threadReadByNativeId.get(thread.data.id);
        let conversation: CodexConversationSession | undefined;
        if (
          !threadRead &&
          previousConversation?.contentSourceUpdatedAt === updatedAt &&
          Date.parse(previousConversation.expiresAt) > now.getTime()
        ) {
          conversation = previousConversation;
        } else if (threadRead?.status === "available") {
          try {
            conversation = normalizeCodexThreadRead({
              result: threadRead.result,
              expectedNativeThreadId: thread.data.id,
              sessionId: id,
              scopeId: scope.id,
              sourceUpdatedAt: updatedAt,
              fetchedAt: now.toISOString(),
              expiresAt: conversationExpiresAt,
              opaqueId: (kind, nativeId) =>
                stableId(
                  config.installationSecret,
                  `${kind}:${nativeId}`
                )
            });
          } catch (error) {
            content = failedCodexContentManifest({
              reasonCode:
                error instanceof Error &&
                error.message.includes(
                  "changed while history was read"
                )
                  ? "THREAD_CHANGED_DURING_READ"
                  : "THREAD_RESPONSE_INVALID",
              previous: previousConversation
            });
          }
        } else {
          content = failedCodexContentManifest({
            reasonCode:
              threadRead?.status === "failed"
                ? "THREAD_READ_FAILED"
                : response.historyReadLimitReached
                  ? "THREAD_READ_LIMIT"
                  : "THREAD_READ_FAILED",
            previous: previousConversation
          });
        }
        if (conversation) {
          conversationSessions.set(id, conversation);
          content = sanitizeContentManifest(
            manifestFromConversationSession(conversation)
          );
        } else if (previousConversation && content.state === "stale") {
          conversationSessions.set(id, previousConversation);
          content = sanitizeContentManifest(content);
        }
      }
    }
    sessions.set(id, {
      id,
      source: "codex",
      kind: "coding_session",
      scopeId: scope.id,
      projectLabel: scope.label,
      taskSummary: taskSummary.value,
      taskSummarySource: taskSummary.source,
      createdAt,
      updatedAt,
      activityState: state.activityState,
      attentionState: state.attentionState,
      content
    });
  }

  const conversationStore: CodexConversationStore | undefined =
    conversationEnabled
      ? codexConversationStoreSchema.parse({
          contract: "codex-conversation-and-execution-store-v1",
          collectorVersion: CODEX_CONVERSATION_COLLECTOR_VERSION,
          consentContract: CODEX_CONVERSATION_CONSENT_CONTRACT,
          collectedAt: now.toISOString(),
          expiresAt: conversationExpiresAt,
          retentionDays: CODEX_CONVERSATION_RETENTION_DAYS,
          scopeIds: selectedScopes
            .map((scope) => scope.id)
            .sort(),
          truncated:
            Boolean(parsed.nextCursor) ||
            Boolean(response.historyReadLimitReached) ||
            [...sessions.values()].some(
              (session) =>
                session.content.state === "partial" ||
                session.content.state === "stale" ||
                session.content.state === "failed"
            ),
          sessions: [...conversationSessions.values()].sort(
            (left, right) =>
              left.sessionId.localeCompare(right.sessionId)
          )
        })
      : undefined;
  const snapshot: CodexSnapshot = {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: conversationEnabled
      ? "codex-app-server-conversation-and-execution-v1"
      : config.contentMode === "activity_summary"
        ? "codex-app-server-activity-summary-v1"
        : "codex-app-server-metadata-v1",
    contentMode: config.contentMode,
    codexVersion: response.codexVersion,
    fetchedAt: now.toISOString(),
    lookbackStart,
    truncated: Boolean(parsed.nextCursor),
    conversationStoreSha256: conversationStore
      ? conversationStoreSha256(conversationStore)
      : null,
    conversationRetentionDays: conversationStore
      ? CODEX_CONVERSATION_RETENTION_DAYS
      : null,
    scopeIds: selectedScopes.map((scope) => scope.id).sort(),
    sessions: [...sessions.values()].sort(
      (left, right) =>
        Date.parse(right.updatedAt) -
          Date.parse(left.updatedAt) ||
        left.id.localeCompare(right.id)
    )
  };
  await writeStoredCodexSnapshot(
    snapshot,
    config,
    options.cwd,
    storeGeneration,
    conversationStore
  );
  return snapshot;
}

function baseThreadListParams(): CodexThreadListParams {
  return {
    cursor: null,
    limit: CODEX_THREAD_LIMIT,
    sortKey: "updated_at",
    sortDirection: "desc",
    sourceKinds: [...INTERACTIVE_SOURCE_KINDS],
    useStateDbOnly: true
  };
}

function lookbackStartFor(now: Date): string {
  return new Date(
    now.getTime() - CODEX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

function normalizedLocalCwd(value: string | null | undefined):
  | string
  | null {
  const normalized = value?.trim();
  if (!normalized || !isAbsolute(normalized)) return null;
  return normalized.replace(/\/+$/, "") || "/";
}

function threadUpdatedAt(
  thread: z.infer<typeof rawThreadSchema>
): string | null {
  return epochSecondsToIso(thread.updatedAt ?? thread.createdAt);
}

function epochSecondsToIso(value: number): string | null {
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseActivityState(status: unknown): {
  activityState: CodexActivityState;
  attentionState: CodexAttentionState;
} {
  const parsed = rawStatusSchema.safeParse(status);
  if (!parsed.success) {
    return { activityState: "unknown", attentionState: null };
  }

  const attentionState = parsed.data.activeFlags?.includes(
    "waitingOnApproval"
  )
    ? "waiting_on_approval"
    : parsed.data.activeFlags?.includes("waitingOnUserInput")
      ? "waiting_on_user_input"
      : null;
  switch (parsed.data.type) {
    case "active":
      return { activityState: "active", attentionState };
    case "idle":
      return { activityState: "idle", attentionState: null };
    case "notLoaded":
      return { activityState: "not_loaded", attentionState: null };
    case "systemError":
      return { activityState: "system_error", attentionState: null };
    default:
      return { activityState: "unknown", attentionState: null };
  }
}

function stableId(secret: string, value: string): string {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

function projectLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return sanitizeLabel(parts.at(-1) ?? "프로젝트");
}

function sanitizeLabel(value: string): string {
  const sanitized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return (sanitized || "프로젝트").slice(0, 120);
}

function codexTaskSummary(
  thread: z.infer<typeof rawThreadSchema>,
  contentMode: CodexContentMode
): {
  value: string | null;
  source: "thread_name" | "first_user_request" | null;
} {
  if (contentMode === "metadata_only") {
    return { value: null, source: null };
  }

  const name = sanitizeTaskSummary(thread.name);
  if (name) {
    return { value: name, source: "thread_name" };
  }
  const preview = sanitizeTaskSummary(thread.preview);
  return preview
    ? { value: preview, source: "first_user_request" }
    : { value: null, source: null };
}

function sanitizeContentManifest(
  manifest: CodexSessionContentManifest
): CodexSessionContentManifest {
  return {
    ...manifest,
    latestUserPromptExcerpt: sanitizeTaskSummary(
      manifest.latestUserPromptExcerpt
    ),
    latestAgentResponseExcerpt: sanitizeTaskSummary(
      manifest.latestAgentResponseExcerpt
    ),
    latestExecutionSummary: sanitizeTaskSummary(
      manifest.latestExecutionSummary
    )
  };
}

function sanitizeTaskSummary(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const sanitized = value
    .replace(
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      " "
    )
    .replace(/https?:\/\/\S+/gi, "[링크]")
    .replace(/(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)/g, "[로컬 경로]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[이메일]"
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|AIza[A-Za-z0-9_-]{12,})\b/g,
      "[비밀값]"
    )
    .replace(/\bBearer\s+\S+/gi, "Bearer [비밀값]")
    .replace(
      /\b(?:api[_ -]?key|access[_ -]?token|secret|password)\s*[:=]\s*\S+/gi,
      "[비밀값]"
    )
    .replace(/\s+/g, " ")
    .trim();
  return sanitized ? sanitized.slice(0, 200) : null;
}

function disambiguateScopeLabels(
  scopes: StoredCodexScope[]
): StoredCodexScope[] {
  const counts = new Map<string, number>();
  for (const scope of scopes) {
    counts.set(scope.label, (counts.get(scope.label) ?? 0) + 1);
  }
  return scopes.map((scope) => {
    if (counts.get(scope.label) === 1) return scope;
    const suffix = ` · ${scope.id.slice(0, 4)}`;
    return {
      ...scope,
      label: `${scope.label.slice(0, 120 - suffix.length)}${suffix}`
    };
  });
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

function normalizeCodexVersion(userAgent: string): string {
  const match = userAgent.match(
    /(?:codex(?:_(?:cli_rs|app_server))?|codex-(?:cli|app-server))[/ ]([0-9][0-9A-Za-z.+-]*)/i
  );
  return match ? `codex-cli ${match[1]}` : "codex-cli";
}

function codexChildEnvironment(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const allowedKeys = [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SHELL",
    "CODEX_HOME",
    "CODEX_SQLITE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME"
  ];
  return {
    NODE_ENV: env.NODE_ENV ?? "development",
    ...Object.fromEntries(
      allowedKeys.flatMap((key) =>
        env[key] ? [[key, env[key]]] : []
      )
    )
  };
}

async function waitForSpawn(
  child: ChildProcessWithoutNullStreams
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      child.kill("SIGTERM");
      reject(
        new CodexConnectorError(
          "APP_SERVER_TIMEOUT",
          "Codex App Server 시작 시간이 초과되었습니다."
        )
      );
    }, CODEX_APP_SERVER_TIMEOUT_MS);

    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        new CodexConnectorError(
          "APP_SERVER_START_FAILED",
          "Codex App Server를 시작하지 못했습니다."
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

class CodexJsonRpcClient {
  private nextId = 1;
  private buffer = "";
  private stdoutBytes = 0;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.stderr.on("data", () => {
      // Drain stderr so the child cannot block, but never retain it because it
      // can contain local paths or sensitive task content.
    });
    child.stdin.on("error", () => {
      if (this.closed) return;
      this.failAll(
        new CodexConnectorError(
          "APP_SERVER_PROTOCOL_ERROR",
          "Codex App Server 입력 스트림이 종료되었습니다."
        )
      );
      this.close();
    });
    child.on("exit", () => {
      if (!this.closed) {
        this.failAll(
          new CodexConnectorError(
            "APP_SERVER_PROTOCOL_ERROR",
            "Codex App Server가 응답 전에 종료되었습니다."
          )
        );
      }
    });
    child.on("error", () => {
      this.failAll(
        new CodexConnectorError(
          "APP_SERVER_START_FAILED",
          "Codex App Server 실행 중 오류가 발생했습니다."
        )
      );
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new CodexConnectorError(
          "APP_SERVER_PROTOCOL_ERROR",
          "Codex App Server 연결이 종료되었습니다."
        )
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CodexConnectorError(
            "APP_SERVER_TIMEOUT",
            "Codex App Server 응답 시간이 초과되었습니다."
          )
        );
      }, CODEX_APP_SERVER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ method, id, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(
      new CodexConnectorError(
        "APP_SERVER_PROTOCOL_ERROR",
        "Codex App Server 연결이 종료되었습니다."
      )
    );
    this.child.stdin.end();
    if (!this.child.killed) this.child.kill("SIGTERM");
  }

  private write(message: object): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.stdoutBytes += Buffer.byteLength(chunk);
    if (this.stdoutBytes > MAX_STDOUT_BYTES) {
      this.failAll(
        new CodexConnectorError(
          "APP_SERVER_PROTOCOL_ERROR",
          "Codex App Server 응답 크기가 허용 범위를 넘었습니다."
        )
      );
      this.close();
      return;
    }

    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.failAll(
        new CodexConnectorError(
          "APP_SERVER_PROTOCOL_ERROR",
          "Codex App Server가 올바르지 않은 JSON을 반환했습니다."
        )
      );
      return;
    }

    if (!message || typeof message !== "object" || !("id" in message)) {
      return;
    }
    const id = (message as { id?: unknown }).id;
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);

    if ("error" in message) {
      pending.reject(
        new CodexConnectorError(
          "APP_SERVER_PROTOCOL_ERROR",
          "Codex App Server 요청이 거부되었습니다."
        )
      );
      return;
    }
    pending.resolve(
      "result" in message
        ? (message as { result: unknown }).result
        : undefined
    );
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
