export type ManagedCodexRunLifecycle =
  | "starting"
  | "observing"
  | "ended"
  | "failed";

export type ManagedCodexStreamState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "closed";

export type ManagedCodexContinuity =
  | "continuous"
  | "unverified"
  | "gap_detected";

export type ManagedCodexExecutionState =
  | "unknown"
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "interrupted";

export type ManagedCodexWaitingState =
  | "waiting_on_approval"
  | "waiting_on_user_input"
  | null;

export type ManagedCodexSourceEvent =
  | "run_started"
  | "stream_connected"
  | "stream_reconnected"
  | "stream_disconnected"
  | "thread_status_changed"
  | "turn_started"
  | "turn_completed"
  | "item_started"
  | "item_completed"
  | "run_failed"
  | "run_closed";

export type ManagedCodexItemType =
  | "user_message"
  | "agent_message"
  | "reasoning"
  | "command_execution"
  | "file_change"
  | "tool_call"
  | "collaboration"
  | "web_search"
  | "context_compaction"
  | "other"
  | null;

export type ManagedCodexPublicRun = {
  managedRunId: `managed_run_${string}`;
  bindingId: string;
  executionId: string;
  lifecycle: ManagedCodexRunLifecycle;
  streamState: ManagedCodexStreamState;
  continuity: ManagedCodexContinuity;
  effectiveExecutionState: ManagedCodexExecutionState;
  lastVerifiedExecutionState: ManagedCodexExecutionState;
  waitingState: ManagedCodexWaitingState;
  sourceEvent: ManagedCodexSourceEvent;
  itemType: ManagedCodexItemType;
  lastObservedAt: string;
  liveObservationAvailable: boolean;
  forbiddenAsAttentionCandidate: true;
};

export type ManagedCodexRunsReadyResponse = {
  status: "ready";
  contract: "codex-managed-public-projection-v1";
  revision: number;
  generatedAt: string;
  runs: ManagedCodexPublicRun[];
};

export type ManagedCodexRunsUnavailableResponse = {
  status: "error" | "unavailable";
  code?: string;
  message?: string;
};

export type ManagedCodexRunsApiResponse =
  | ManagedCodexRunsReadyResponse
  | ManagedCodexRunsUnavailableResponse;

export async function fetchManagedCodexRuns(): Promise<ManagedCodexRunsApiResponse> {
  const response = await fetch("/api/managed-codex-runs", {
    cache: "no-store"
  });
  return (await response.json()) as ManagedCodexRunsApiResponse;
}
