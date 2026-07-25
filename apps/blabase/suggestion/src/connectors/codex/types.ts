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
  | "activity_summary";

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
};

export type CodexSnapshot = {
  schemaVersion: "codex-snapshot-v2";
  collectorVersion:
    | "codex-app-server-metadata-v1"
    | "codex-app-server-activity-summary-v1";
  contentMode: CodexContentMode;
  codexVersion: string;
  fetchedAt: string;
  lookbackStart: string;
  truncated: boolean;
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
  schemaVersion: "codex-connector-config-v2";
  installationSecret: string;
  selectedScopeIds: string[];
  scopes: StoredCodexScope[];
  contentMode: CodexContentMode;
  contentConsentAt: string | null;
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
      sessions: CodexPreviewSession[];
    }
  | {
      status: "sync_error";
      message: string;
      lastSyncedAt: string | null;
    };
