export type CodexActivityState =
  | "active"
  | "idle"
  | "not_loaded"
  | "system_error"
  | "unknown";

export type CodexAttentionState =
  | "waiting_on_approval"
  | "waiting_on_user_input"
  | null;

export type CodexContentMode =
  | "metadata_only"
  | "activity_summary"
  | "conversation_and_execution";

export type CodexHistoricalTurnStatus =
  | "completed"
  | "failed"
  | "interrupted"
  | "in_progress"
  | "unknown";

export type CodexConversationCollectionState =
  | "not_collected"
  | "complete"
  | "partial"
  | "stale"
  | "failed"
  | "expired";

export type CodexConversationReasonCode =
  | "CONTENT_MODE_DISABLED"
  | "OUTSIDE_RAW_RETENTION_WINDOW"
  | "THREAD_READ_LIMIT"
  | "THREAD_READ_FAILED"
  | "THREAD_RESPONSE_INVALID"
  | "THREAD_CHANGED_DURING_READ"
  | "TURN_LIMIT"
  | "ITEM_LIMIT"
  | "FIELD_BYTE_LIMIT"
  | "THREAD_BYTE_LIMIT"
  | "UNSUPPORTED_ITEM"
  | "REASONING_EXCLUDED_BY_POLICY";

export type CodexSessionContentManifest = {
  state: CodexConversationCollectionState;
  contentSha256: string | null;
  contentSourceUpdatedAt: string | null;
  collectedAt: string | null;
  expiresAt: string | null;
  historicalTurnStatus: CodexHistoricalTurnStatus;
  latestTurnCompletedAt: string | null;
  turnCount: number;
  userPromptCount: number;
  agentResponseCount: number;
  commandExecutionCount: number;
  failedCommandCount: number;
  fileChangeCount: number;
  toolCallCount: number;
  omittedReasoningItemCount: number;
  omittedUnsupportedItemCount: number;
  truncated: boolean;
  reasonCodes: CodexConversationReasonCode[];
  latestUserPromptExcerpt: string | null;
  latestAgentResponseExcerpt: string | null;
  latestExecutionSummary: string | null;
};

export type CodexTaskSummarySource =
  | "thread_name"
  | "first_user_request"
  | null;

export type CodexSessionSignal = {
  id: string;
  source: "codex";
  kind: "coding_session";
  scopeId: string;
  projectLabel: string;
  taskSummary: string | null;
  taskSummarySource: CodexTaskSummarySource;
  createdAt: string;
  updatedAt: string;
  activityState: CodexActivityState;
  attentionState: CodexAttentionState;
  content: CodexSessionContentManifest;
};

export type CodexSnapshot = {
  schemaVersion: "codex-snapshot-v3";
  collectorVersion:
    | "codex-app-server-metadata-v1"
    | "codex-app-server-activity-summary-v1"
    | "codex-app-server-conversation-and-execution-v1";
  contentMode: CodexContentMode;
  codexVersion: string;
  fetchedAt: string;
  lookbackStart: string;
  truncated: boolean;
  conversationStoreSha256: string | null;
  conversationRetentionDays: 7 | null;
  scopeIds: string[];
  sessions: CodexSessionSignal[];
};

export type StoredCodexScope = {
  id: string;
  queryPath: string;
  label: string;
  sessionCount: number;
  lastActivityAt: string;
};

export type StoredCodexConfig = {
  schemaVersion: "codex-connector-config-v3";
  installationSecret: string;
  selectedScopeIds: string[];
  scopes: StoredCodexScope[];
  contentMode: CodexContentMode;
  contentConsentAt: string | null;
  conversationConsentContract:
    | "codex-conversation-content-consent-v1"
    | null;
  conversationConsentAt: string | null;
  conversationRetentionDays: 7 | null;
  discoveredAt: string;
};

export type CodexScopeOption = {
  id: string;
  label: string;
  sessionCount: number;
  lastActivityAt: string;
  selected: boolean;
};

export type CodexPreviewSession = {
  id: string;
  projectLabel: string;
  taskSummary: string | null;
  taskSummarySource: CodexTaskSummarySource;
  createdAt: string;
  updatedAt: string;
  contentState: CodexConversationCollectionState;
  historicalTurnStatus: CodexHistoricalTurnStatus;
  userPromptCount: number;
  agentResponseCount: number;
  commandExecutionCount: number;
  failedCommandCount: number;
  fileChangeCount: number;
  toolCallCount: number;
  latestUserPromptExcerpt: string | null;
  latestAgentResponseExcerpt: string | null;
  latestExecutionSummary: string | null;
};

export type CodexConversationCollectionSummary = {
  enabled: boolean;
  retentionDays: 7 | null;
  consentedAt: string | null;
  completeSessionCount: number;
  partialSessionCount: number;
  failedSessionCount: number;
  storedSessionCount: number;
  turnCount: number;
  userPromptCount: number;
  agentResponseCount: number;
  commandExecutionCount: number;
  failedCommandCount: number;
  fileChangeCount: number;
  toolCallCount: number;
  truncated: boolean;
};

export type CodexConnectionState =
  | {
      status: "unavailable";
      message: string;
      localUrl?: string;
    }
  | {
      status: "disconnected";
    }
  | {
      status: "scope_selection";
      message: string;
      contentMode: CodexContentMode;
      scopes: CodexScopeOption[];
    }
  | {
      status: "connected";
      codexVersion: string;
      lastSyncedAt: string;
      lookbackStart: string;
      sessionCount: number;
      projectCount: number;
      truncated: boolean;
      contentMode: CodexContentMode;
      conversationCollection: CodexConversationCollectionSummary;
      sessions: CodexPreviewSession[];
    }
  | {
      status: "sync_error";
      message: string;
      lastSyncedAt: string | null;
    };
