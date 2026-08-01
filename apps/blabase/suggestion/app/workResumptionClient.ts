export type WorkResumptionTaskRef = {
  kind: "attention_subject";
  source: "github" | "codex" | "notion" | "manual";
  subjectId: string;
  displayTitle: string;
};

export type WorkResumptionTaskIdentity = Omit<
  WorkResumptionTaskRef,
  "displayTitle"
>;

export type WorkSessionBinding = {
  bindingId: string;
  taskRef: WorkResumptionTaskIdentity;
  executionId: string;
  boundAt: string;
};

export type WorkResumptionCommandStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "expired";

export type WorkResumptionCommand = {
  commandId: string;
  bindingId: string;
  operation: "focus_or_resume";
  status: WorkResumptionCommandStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  resultCode:
    | "FOCUSED_EXISTING"
    | "RESUMED_IN_TERMINAL"
    | "EXECUTION_NOT_FOUND"
    | "EXECUTION_STALE"
    | "CODEX_UNAVAILABLE"
    | "LAUNCH_FAILED"
    | "LAUNCH_OUTCOME_UNKNOWN"
    | "UNSUPPORTED_PLATFORM"
    | "COMMAND_EXPIRED"
    | null;
};

export type WorkResumptionReadyResponse = {
  status: "ready";
  companion: {
    state: "online" | "offline";
    lastSeenAt: string | null;
  };
  bindings: WorkSessionBinding[];
  acceptedCommand?: WorkResumptionCommand;
  command?: WorkResumptionCommand | null;
};

type WorkResumptionUnavailableResponse = {
  status: "error" | "unavailable";
  code?: string;
  message?: string;
};

export type WorkResumptionApiResponse =
  | WorkResumptionReadyResponse
  | WorkResumptionUnavailableResponse;

export async function fetchWorkResumption(
  commandId?: string
): Promise<WorkResumptionApiResponse> {
  const query = commandId
    ? `?commandId=${encodeURIComponent(commandId)}`
    : "";
  return requestWorkResumption(`/api/work-resumption${query}`, {
    cache: "no-store"
  });
}

export async function bindWorkSession(input: {
  taskRef: WorkResumptionTaskRef;
  executionId: string;
}): Promise<WorkResumptionApiResponse> {
  return mutateWorkResumption({
    action: "bind",
    taskRef: input.taskRef,
    executionId: input.executionId,
    explicitUserConfirmation: true
  });
}

export async function unbindWorkSession(input: {
  taskRef: WorkResumptionTaskRef;
}): Promise<WorkResumptionApiResponse> {
  return mutateWorkResumption({
    action: "unbind",
    taskRef: input.taskRef,
    explicitUserConfirmation: true
  });
}

export async function openWorkSession(input: {
  taskRef: WorkResumptionTaskRef;
}): Promise<WorkResumptionApiResponse> {
  return mutateWorkResumption({
    action: "open",
    taskRef: input.taskRef,
    explicitUserAction: true
  });
}

async function mutateWorkResumption(
  body: Record<string, unknown>
): Promise<WorkResumptionApiResponse> {
  return requestWorkResumption("/api/work-resumption", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function requestWorkResumption(
  url: string,
  init: RequestInit
): Promise<WorkResumptionApiResponse> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as WorkResumptionApiResponse;
  if (!response.ok) {
    throw new WorkResumptionRequestError(
      payload.status === "error" ? payload.code : undefined,
      payload.status === "error" ? payload.message : undefined
    );
  }
  return payload;
}

export class WorkResumptionRequestError extends Error {
  readonly code: string | undefined;

  constructor(code?: string, message?: string) {
    super(message ?? "Work resumption request failed.");
    this.name = "WorkResumptionRequestError";
    this.code = code;
  }
}
