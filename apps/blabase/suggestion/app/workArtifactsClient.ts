export type WorkArtifactMutationReadyResponse = {
  status: "ready";
  attributionId?: string;
};

type WorkArtifactMutationErrorResponse = {
  status: "error" | "unavailable";
  code?: string;
  message?: string;
};

export type WorkArtifactMutationResponse =
  | WorkArtifactMutationReadyResponse
  | WorkArtifactMutationErrorResponse;

export async function attachWorkArtifact(input: {
  managedRunId: string;
  bindingId: string;
  executionId: string;
  artifactUrl: string;
}): Promise<WorkArtifactMutationReadyResponse> {
  return mutateWorkArtifact({
    action: "attach",
    managedRunId: input.managedRunId,
    bindingId: input.bindingId,
    executionId: input.executionId,
    artifactUrl: input.artifactUrl,
    explicitUserConfirmation: true
  });
}

export async function detachWorkArtifact(input: {
  attributionId: string;
}): Promise<WorkArtifactMutationReadyResponse> {
  return mutateWorkArtifact({
    action: "detach",
    attributionId: input.attributionId,
    explicitUserConfirmation: true
  });
}

async function mutateWorkArtifact(
  body: Record<string, unknown>
): Promise<WorkArtifactMutationReadyResponse> {
  const response = await fetch("/api/work-artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const payload = (await response.json()) as WorkArtifactMutationResponse;
  if (!response.ok || payload.status !== "ready") {
    throw new WorkArtifactRequestError(
      payload.status === "ready" ? undefined : payload.code,
      payload.status === "ready" ? undefined : payload.message
    );
  }
  return payload;
}

export class WorkArtifactRequestError extends Error {
  readonly code: string | undefined;

  constructor(code?: string, message?: string) {
    super(message ?? "Work artifact request failed.");
    this.name = "WorkArtifactRequestError";
    this.code = code;
  }
}
